import { getStore } from "@netlify/blobs";

// ---- Mock market data (annual volatility, %) ----
const SECTOR_VOL = {
  Technology: 30, Energy: 28, Finance: 22, Healthcare: 18,
  Consumer: 16, Utilities: 12, Industrials: 20, Other: 20,
};
const TICKER_VOL = {
  TSLA: 55, NVDA: 48, AMD: 45, META: 38, AMZN: 33, AAPL: 27, MSFT: 25,
  GOOGL: 29, JPM: 21, KO: 14, PG: 13, JNJ: 15, XOM: 26,
};

const round = (n) => Math.round(n * 10) / 10;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ---- Validation ----
function validate(body) {
  if (!body || !Array.isArray(body.holdings) || body.holdings.length === 0)
    return "Add at least one holding.";
  if (body.holdings.length > 30) return "A portfolio can have at most 30 holdings.";
  for (const h of body.holdings) {
    if (!h.ticker || !/^[A-Za-z.]{1,6}$/.test(h.ticker.trim()))
      return `Invalid ticker: "${h.ticker ?? ""}". Use 1–6 letters.`;
    if (!SECTOR_VOL[h.sector]) return `Unknown sector for ${h.ticker}.`;
    const w = Number(h.weight);
    if (!(w > 0 && w <= 100)) return `Weight for ${h.ticker} must be between 0 and 100.`;
  }
  const total = body.holdings.reduce((s, h) => s + Number(h.weight), 0);
  if (Math.abs(total - 100) > 0.5)
    return `Weights must add up to 100% (currently ${round(total)}%).`;
  return null;
}

// ---- Risk engine ----
export function computeRisk(holdings) {
  const total = holdings.reduce((s, h) => s + Number(h.weight), 0);
  const items = holdings.map((h) => {
    const ticker = h.ticker.trim().toUpperCase();
    return {
      ticker,
      sector: h.sector,
      weight: Number(h.weight) / total, // normalise to 1
      volatility: TICKER_VOL[ticker] ?? SECTOR_VOL[h.sector],
    };
  });

  // 1) Volatility: weighted average vol, 40% annual vol = score 100
  const avgVol = items.reduce((s, i) => s + i.weight * i.volatility, 0);
  const volatilityScore = Math.min(100, (avgVol / 40) * 100);

  // 2) Sector concentration: HHI across sectors (1 sector = 100)
  const sectors = {};
  items.forEach((i) => (sectors[i.sector] = (sectors[i.sector] || 0) + i.weight));
  const sectorHHI = Object.values(sectors).reduce((s, w) => s + w * w, 0);
  const concentrationScore = sectorHHI * 100;

  // 3) Diversification: HHI across individual holdings (1 stock = 100)
  const holdingHHI = items.reduce((s, i) => s + i.weight * i.weight, 0);
  const diversificationScore = holdingHHI * 100;

  const overall =
    0.4 * volatilityScore + 0.3 * concentrationScore + 0.3 * diversificationScore;

  const level = overall < 35 ? "Low" : overall < 60 ? "Moderate" : "High";

  const tips = [];
  const topSector = Object.entries(sectors).sort((a, b) => b[1] - a[1])[0];
  if (topSector[1] > 0.5)
    tips.push(`${Math.round(topSector[1] * 100)}% of your portfolio is in ${topSector[0]}. Spread it across more sectors.`);
  if (items.length < 5) tips.push("Fewer than 5 holdings. Add more stocks to reduce single-stock risk.");
  const topHolding = [...items].sort((a, b) => b.weight - a.weight)[0];
  if (topHolding.weight > 0.3)
    tips.push(`${topHolding.ticker} is ${Math.round(topHolding.weight * 100)}% of the portfolio. Consider trimming it.`);
  if (avgVol > 30) tips.push("Average volatility is high. Add steadier names such as utilities or consumer staples.");
  if (!tips.length) tips.push("Your portfolio looks balanced. Keep reviewing it regularly.");

  return {
    overall: round(overall),
    level,
    breakdown: {
      volatility: round(volatilityScore),
      concentration: round(concentrationScore),
      diversification: round(diversificationScore),
    },
    avgVolatility: round(avgVol),
    sectors: Object.fromEntries(Object.entries(sectors).map(([k, v]) => [k, round(v * 100)])),
    tips,
  };
}

export default async (req) => {
  const url = new URL(req.url);
  let store = null;
  try { store = getStore("portfolios"); } catch (_) { /* storage optional */ }

  // GET /api/score            -> last 10 saved assessments
  // GET /api/score?id=<id>    -> one saved assessment
  if (req.method === "GET") {
    if (!store) return json({ error: "Storage unavailable." }, 503);
    try {
      const id = url.searchParams.get("id");
      if (id) {
        const item = await store.get(id, { type: "json" });
        return item ? json(item) : json({ error: "Not found." }, 404);
      }
      const { blobs } = await store.list();
      const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 10);
      const items = await Promise.all(keys.map((k) => store.get(k, { type: "json" })));
      return json(items.filter(Boolean));
    } catch (e) {
      return json({ error: "Could not load history." }, 500);
    }
  }

  // POST /api/score -> compute + save
  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
    const err = validate(body);
    if (err) return json({ error: err }, 400);

    const result = computeRisk(body.holdings);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      id,
      name: (body.name || "Untitled portfolio").toString().slice(0, 60),
      createdAt: new Date().toISOString(),
      holdings: body.holdings,
      result,
    };
    let saved = false;
    if (store) {
      try { await store.setJSON(id, record); saved = true; } catch (_) {}
    }
    return json({ ...record, saved });
  }

  return json({ error: "Method not allowed." }, 405);
};

export const config = { path: "/api/score" };
