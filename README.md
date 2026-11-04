# Stock Portfolio Risk Scorer

Serverless web app (Netlify Functions + Netlify Blobs) that scores a mock stock portfolio from 0–100.

## Structure
- `public/index.html`            – frontend (HTML/CSS/JS)
- `netlify/functions/score.mjs`  – serverless API (POST = score + save, GET = history)
- `netlify.toml`                 – Netlify config

## Scoring
| Factor | Weight | How |
|---|---|---|
| Volatility | 40% | Weighted average annual volatility (40% = 100) |
| Sector concentration | 30% | Herfindahl index over sector weights |
| Diversification | 30% | Herfindahl index over holding weights |

Overall < 35 = Low, 35–60 = Moderate, 60+ = High.

## Deploy
1. Push this folder to a GitHub repo.
2. Netlify > Add new site > Import from Git > pick the repo (no build command needed).
3. Deploy. Open the site URL.

Or with CLI: `npm i -g netlify-cli && npm install && netlify deploy --prod`
Local test: `netlify dev`
