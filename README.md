# Liquidity Flow Monitor

A dashboard for one question: **when stocks and ETFs sell off, where does the money go?**

It tracks **real fund flows** (creations and redemptions in State Street's SPDR funds: the
S&P 500, all eleven sectors, international stocks, Treasuries, corporate and high-yield bonds,
T-bills and gold, plus stablecoin issuance for crypto), **futures positioning** from the CFTC,
**rates and credit**, prices for markets without an SPDR fund (Nasdaq 100, small caps, bitcoin,
ether, the dollar, commodities), and the places cash parks: stablecoins, retail money market
funds, the Fed's reverse repo facility and the Treasury's cash account.

## What's on the page

Four sections, each one card (most with tabs), so the page stays short:

| Section | What it shows |
|---|---|
| **Where money is flowing** | Tabs: **Classes** (money in and out of stocks, bonds, cash, gold & commodities and crypto as bars, with net new money on top; tap a class to open its funds; can show any past week, month or selloff), **Map** (every fund as a tile sized by its assets and coloured by its flow as a share of the fund), **Vs returns** (chasing strength, buying the dip, taking profits, capitulation). Below it, the **running total** of each class's flows by day, week or month |
| **Where the money sits** | Stacked bars of the market value held in stocks, real estate, bonds, cash, gold and crypto each month (or year) since 2017, with **Linear / Log / Share %** views, a tooltip that ranks the classes, and the period in progress striped. Sizes are estimates: Fed Financial Accounts for stocks (carried monthly by the S&P 500), households' real estate (carried by Case-Shiller) and corporate bonds, Dallas Fed Treasury market value, M2 plus companies' money funds for cash, World Gold Council tonnes times the gold price, coins in circulation times prices plus stablecoins for crypto |
| **When stocks sell off** | How often and how deep selloffs are, then tabs: **Playbook** (what rose while stocks fell, across every S&P 500 selloff of 7%+ since 2016) and **Every selloff** (each market in each selloff; tap one to see its flows by class) |
| **Backdrop** | Tabs, each a compact table with sparklines and a chart of the selected row: **Cash** (stablecoins, money market funds and their estimated net flows, retail money funds, reverse repo, TGA, Fed net liquidity), **Rates** (T-bill, 10-year, 2s10s curve, real yield, high-yield spread, financial conditions), **Positioning** (speculators' futures positions in 11 markets as a percentile of three years), **Risk** (risk appetite score and its ingredients, correlations with stocks) |

Tapping any fund opens its **close-up**: price and flows over the range, its last 8 weeks and its record in past selloffs.
The guide at the bottom (folded by default) explains every number.

Every chart has a **Table** toggle with the underlying numbers and a CSV download.

A **date range** bar under the menu (1W, 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, All, or custom dates) drives
every chart and table. The page aggregates the range itself from the daily rows (last three years)
or monthly rows (since 2017) that the pipeline publishes in `series`.

An **Inflation-adjusted** option in the ⋯ menu next to it restates dollar amounts in today's dollars and
returns as real returns, using monthly CPI (`CPIAUCSL` from FRED).

## How flows are measured

Every share sold has a buyer, so trading alone doesn't move money between markets. What
does is investors putting new money into funds or pulling it out. State Street publishes
each SPDR fund's shares outstanding every day: new shares times NAV is money put in,
cancelled shares money taken out. A day where the share count jumps or falls by half or more
(a split or a reporting glitch) counts as no flow. Crypto's flow is the change in total USD
stablecoin supply.

SPDR funds are a large, consistent sample of US ETFs (well over a trillion dollars), not the
whole market, so read sizes as a sample and directions as the signal. Bond and international
coverage is thinner than stocks and gold, which is why the page also shows each flow as a
share of the fund's size.

The Classes view adds flows up within each class and shows the **net new money** on top:
what came into the tracked funds from outside (bank deposits, other funds) or left them
altogether. It shows only what is measured, money in and out of each fund, not who sold to
whom.

## Data sources (all free, no API keys)

- **State Street**: daily NAV and shares outstanding for 20 SPDR funds (real fund flows)
- **Yahoo Finance**: daily prices and volume for 26 ETFs and crypto pairs (Stooq as a fallback for ETFs), and gold futures
- **OFR** (Office of Financial Research): total US money market fund assets, monthly, from SEC Form N-MFP
- **CFTC**: weekly Commitments of Traders (Traders in Financial Futures and Disaggregated reports)
- **FRED**: `NCBEILQ027S` and `BOGZ1LM793164105Q` (US companies' shares), `HNOREMQ027S` and `CSUSHPISA`
  (households' real estate), `MVMTD027MNFRBDAL` (Treasuries at market value), `NCBDBIQ027S` (company bonds), `WALCL` (Fed balance sheet), `WTREGEN` (TGA), `RRPONTSYD` (reverse repo),
  `RMFSL` (retail money funds), `M2SL`, `CPIAUCSL` (CPI), `DTB3`, `DGS10`, `T10Y2Y`, `DFII10`,
  `BAMLH0A0HYM2` (high-yield spread; FRED keeps three years of it), `NFCI`
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
sources, commits it, and redeploys the site. If more than a third of the prices or of the fund
flow files fail to download, the build stops and the previous data stays in place; smaller
gaps are listed in a warning banner on the page.

## Alerts

On the daily refresh, `pipeline/alerts.py` compares the new data with the previous day's and
opens a GitHub issue when something changes: the market mood flips, a selloff starts or ends,
a week of flows is among the heaviest 5% of the past three years, a risk signal turns
extreme, or speculators' futures positioning reaches the top or bottom 5% of its three-year range. GitHub emails repository owners about new issues by default; adjust that under
your notification settings or the repository's **Watch** menu.

## Sharing a view

The address bar keeps the selected range, open tabs, replayed period, open close-up and history
view (for example `#range=3M&f=funds&b=positioning&m=GLD`, or `#from=2020-02-01&to=2020-04-30`), and the
**Share** button copies it.

## Layout

```
pipeline/
  config.py     universe, FRED series, windows, selloff threshold
  sources.py    fetchers and parsers for State Street, Yahoo, Stooq, CFTC, FRED, DefiLlama
  analytics.py  fund flows, rotation allocation, selloff detection, positioning, risk score
  demo.py       synthetic data generator
  build.py      CLI that writes docs/data/dashboard.json
docs/           static site (index.html, app.js, styles.css; ECharts in docs/vendor)
tests/          pytest suite
```

Not investment advice.
