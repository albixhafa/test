# Liquidity Flow Monitor

A dashboard for one question: **when stocks and ETFs sell off, where does the money go?**

It tracks cross-asset rotation across US and global equities, defensive sectors, Treasuries
and T-bills, credit, gold, commodities, the US dollar and crypto, alongside the places cash
parks: stablecoins, retail money market funds, the Fed's reverse repo facility and the
Treasury's cash account.

## What's on the page

| Panel | Question it answers |
|---|---|
| Headline tiles | Risk-on or risk-off right now? How much dry powder is sitting in cash? |
| Rotation map (Sankey) | Over the last week, month or quarter, which markets saw net selling and where did that pressure go? |
| Buying vs selling pressure | Net flow per market as a share of its normal turnover |
| Selloff playbook | Across every S&P 500 selloff of 7%+ since 2016, what rose while stocks fell? |
| Every selloff, every market | Peak-to-trough return of every market in every selloff, with cash-bucket changes in the table view |
| Dry powder | Stablecoin supply, retail money funds, reverse repo, TGA and Fed net liquidity, with selloffs shaded |
| Risk appetite | A composite z-score of equities, small caps vs large, credit vs Treasuries, bitcoin, the dollar and VIX |
| Correlation to stocks | Is bitcoin, gold, Treasuries, the dollar or high yield still a hedge? |

Every chart has a **Table** toggle with the underlying numbers.

## Important caveat: flows are estimated

Every share sold has a buyer, so a selloff doesn't drain a fixed pot of money. What
changes is who holds what. True fund flows (ETF creations and redemptions, money fund
subscriptions) mostly sit behind paid data, so this dashboard estimates flow pressure
with Chaikin money flow (each day's dollar volume, signed by where the close landed in the
day's range). The rotation map splits each net outflow across net inflows in proportion to
size and routes any imbalance through a *Cash & sidelines* node. Read it as pressure, not
as a ledger of who bought from whom.

## Data sources (all free, no API keys)

- **Yahoo Finance**: daily OHLCV for 15 ETFs plus BTC and ETH (Stooq as a fallback for ETFs)
- **FRED**: `WALCL` (Fed balance sheet), `WTREGEN` (TGA), `RRPONTSYD` (reverse repo),
  `RMFSL` (retail money funds), `M2SL`
- **DefiLlama**: total USD stablecoin supply

Edit `pipeline/config.py` to change the universe, lookback windows or the selloff threshold.

## Running it

```bash
pip install -r requirements.txt
python -m pipeline.build          # fetch live data -> docs/data/dashboard.json
python -m pipeline.build --demo   # synthetic data, no network needed
python -m http.server -d docs     # open http://localhost:8000
python -m pytest -q               # tests (pip install pytest)
```

The committed `docs/data/dashboard.json` is **synthetic demo data** (the page shows a
banner saying so) until the first live refresh replaces it.

## Hosting on GitHub Pages with daily refresh

1. In the repository settings, open **Pages** and set the source to **GitHub Actions**.
2. Run the **Refresh data** workflow once from the Actions tab.

After that it runs every weekday after the US close: it rebuilds `dashboard.json` from live
sources, commits it, and redeploys the site. If more than a third of the markets fail to
download, the build stops and the previous data stays in place; smaller gaps are listed in a
warning banner on the page.

## Layout

```
pipeline/
  config.py     universe, FRED series, windows, selloff threshold
  sources.py    fetchers and parsers for Yahoo, Stooq, FRED, DefiLlama
  analytics.py  money flow, rotation allocation, selloff detection, risk score
  demo.py       synthetic data generator
  build.py      CLI that writes docs/data/dashboard.json
docs/           static site (index.html, app.js, styles.css; ECharts from cdnjs)
tests/          pytest suite
```

Not investment advice.
