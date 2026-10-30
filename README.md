# Liquidity Flow Monitor

A dashboard for one question: **when stocks and ETFs sell off, where does the money go?**

It tracks cross-asset rotation across US and global equities, defensive sectors, Treasuries
and T-bills, credit, gold, commodities, the US dollar and crypto, alongside the places cash
parks: stablecoins, retail money market funds, the Fed's reverse repo facility and the
Treasury's cash account.

## What's on the page

| Panel | Question it answers |
|---|---|
| Right now | The page in five plain sentences: selloff or not, mood, where money went, cash on the sidelines, what to watch |
| Headline tiles | Risk-on or risk-off right now? How much dry powder is sitting in cash? (each with an ⓘ explanation) |
| Liquidity wheel | A circle of all the money moving between stocks, bonds, cash, gold & commodities, crypto and the dollar, with the total in the middle; can replay any past week, month or selloff |
| Market close-up | Price and week-by-week flow for any one market over three years, plus its record in past selloffs |
| Liquidity history | Net flows per class week by week (3 years) or month by month (since 2017), as bars or running totals |
| Outlook | Selloffs in perspective, which markets held up and bounced back in past selloffs, 8-week flow momentum, price/flow divergences, dry powder |
| Rotation map (Sankey) | Over the last week, month or quarter, which markets saw net selling and where did that pressure go? |
| Buying vs selling pressure | Net flow per market as a share of its normal turnover |
| Selloff playbook | Across every S&P 500 selloff of 7%+ since 2016, what rose while stocks fell? |
| Every selloff, every market | Peak-to-trough return of every market in every selloff, with cash-bucket changes in the table view |
| Dry powder | Stablecoin supply, retail money funds, reverse repo, TGA and Fed net liquidity, with selloffs shaded |
| Risk appetite | A composite z-score of equities, small caps vs large, credit vs Treasuries, bitcoin, the dollar and VIX |
| Correlation to stocks | Is bitcoin, gold, Treasuries, the dollar or high yield still a hedge? |

Every chart has a **Table** toggle with the underlying numbers.

A **date range** bar under the menu (1W, 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, All, or custom dates) drives
every chart and table. The page aggregates the range itself from the daily rows (last three years)
or monthly rows (since 2017) that the pipeline publishes in `series`.

## Important caveat: flows are estimated

Every share sold has a buyer, so a selloff doesn't drain a fixed pot of money. What
changes is who holds what. True fund flows (ETF creations and redemptions, money fund
subscriptions) mostly sit behind paid data, so this dashboard estimates flow pressure
with Chaikin money flow (each day's dollar volume, signed by where the close landed in the
day's range), measured against each market's own trailing one-year average so only unusual
buying or selling counts. The rotation map splits each net outflow across net inflows in proportion to
size and routes any imbalance through a *Cash & sidelines* node. The liquidity wheel does the
same at the asset-class level, with cash as the balancing account. Read both as pressure, not
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

## Alerts

On the daily refresh, `pipeline/alerts.py` compares the new data with the previous day's and
opens a GitHub issue when something changes: the market mood flips, a selloff starts or ends,
a week of flows is among the heaviest 5% of the past three years, or a risk signal turns
extreme. GitHub emails repository owners about new issues by default; adjust that under
your notification settings or the repository's **Watch** menu.

## Sharing a view

The address bar keeps the selected window, replayed period, market close-up and history
view (for example `#range=3M&r=ep:12&m=GLD`, or `#from=2020-02-01&to=2020-04-30`), and the **Share** button copies it.

## Layout

```
pipeline/
  config.py     universe, FRED series, windows, selloff threshold
  sources.py    fetchers and parsers for Yahoo, Stooq, FRED, DefiLlama
  analytics.py  money flow, rotation allocation, selloff detection, risk score
  demo.py       synthetic data generator
  build.py      CLI that writes docs/data/dashboard.json
docs/           static site (index.html, app.js, styles.css; ECharts and D3 in docs/vendor)
tests/          pytest suite
```

Not investment advice.
