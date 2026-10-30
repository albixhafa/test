"""Universe definition: which markets we track and which macro series describe cash."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Asset:
    ticker: str  # Yahoo Finance symbol
    name: str
    group: str
    stooq: str | None = None  # fallback symbol on stooq.com (ETFs only)
    usd_volume: bool = False  # Yahoo reports volume in USD rather than units (crypto pairs)
    short: str | None = None  # compact label for dense charts; defaults to name
    # Where real money flows come from: "ssga" (State Street's daily shares outstanding
    # and NAV, so flow = change in shares x NAV) or "stablecoins" (change in total
    # stablecoin supply). None means the market is tracked for price only.
    flows: str | None = None


# Asset classes, in display order; the dashboard assigns colours by this order and
# the liquidity wheel draws one arc per class.
GROUPS = [
    "Stocks",
    "Bonds",
    "Cash",
    "Gold & commodities",
    "Crypto",
    "Sidelines",
]
# The wheel's balancing account: money that entered the tracked funds from outside
# (bank deposits, other funds) or left them altogether. It holds no markets.
BALANCE_GROUP = "Sidelines"

# Every market with flows="ssga" is a State Street SPDR fund, so all flows come from one
# issuer's published shares outstanding: a large, consistent sample of US ETF flows,
# not the whole market. Price-only markets fill in where no SPDR fund exists.
ASSETS = [
    Asset("SPY", "S&P 500", "Stocks", "spy.us", flows="ssga"),
    Asset("QQQ", "Nasdaq 100", "Stocks", "qqq.us", short="Nasdaq"),
    Asset("IWM", "Small caps", "Stocks", "iwm.us"),
    Asset("SPDW", "International stocks", "Stocks", "spdw.us", short="Intl", flows="ssga"),
    Asset("SPEM", "Emerging markets", "Stocks", "spem.us", short="EM", flows="ssga"),
    Asset("XLK", "Technology", "Stocks", "xlk.us", short="Tech", flows="ssga"),
    Asset("XLF", "Financials", "Stocks", "xlf.us", flows="ssga"),
    Asset("XLE", "Energy", "Stocks", "xle.us", flows="ssga"),
    Asset("XLV", "Health care", "Stocks", "xlv.us", flows="ssga"),
    Asset("XLI", "Industrials", "Stocks", "xli.us", flows="ssga"),
    Asset("XLY", "Consumer discretionary", "Stocks", "xly.us", short="Discretionary", flows="ssga"),
    Asset("XLP", "Consumer staples", "Stocks", "xlp.us", short="Staples", flows="ssga"),
    Asset("XLU", "Utilities", "Stocks", "xlu.us", flows="ssga"),
    Asset("XLB", "Materials", "Stocks", "xlb.us", flows="ssga"),
    Asset("XLRE", "Real estate", "Stocks", "xlre.us", flows="ssga"),
    Asset("XLC", "Communication services", "Stocks", "xlc.us", short="Communication", flows="ssga"),
    Asset("BIL", "T-bills (cash)", "Cash", "bil.us", short="T-bills", flows="ssga"),
    Asset("UUP", "US dollar", "Cash", "uup.us", short="Dollar"),
    Asset("SPTI", "Treasuries (3–10y)", "Bonds", "spti.us", short="Treasuries", flows="ssga"),
    Asset("SPTL", "Long Treasuries (10y+)", "Bonds", "sptl.us", short="Long bonds", flows="ssga"),
    Asset("SPBO", "Corporate bonds", "Bonds", "spbo.us", short="Corp bonds", flows="ssga"),
    Asset("JNK", "High-yield bonds", "Bonds", "jnk.us", short="Junk bonds", flows="ssga"),
    Asset("GLD", "Gold", "Gold & commodities", "gld.us", flows="ssga"),
    Asset("DBC", "Commodities", "Gold & commodities", "dbc.us", short="Commod."),
    Asset("BTC-USD", "Bitcoin", "Crypto", usd_volume=True, short="Bitcoin"),
    Asset("ETH-USD", "Ether", "Crypto", usd_volume=True, short="Ether"),
    # Not a market: total USD stablecoin supply, the cash that enters and leaves crypto.
    # Its "price" is the supply itself, so the close-up shows how the pile has grown.
    Asset("STABLES", "Stablecoins", "Crypto", short="Stablecoins", flows="stablecoins"),
]

BENCHMARK = "SPY"
VIX = "^VIX"

# FRED series pulled via the keyless fredgraph.csv endpoint.
# unit_scale converts the native unit to billions of USD.
FRED_SERIES = {
    "WALCL": {"name": "Fed balance sheet", "unit_scale": 1e-3},
    "WTREGEN": {"name": "Treasury General Account", "unit_scale": 1e-3},
    "RRPONTSYD": {"name": "Overnight reverse repo", "unit_scale": 1.0},
    "RMFSL": {"name": "Retail money market funds", "unit_scale": 1.0},
    "M2SL": {"name": "M2 money supply", "unit_scale": 1.0},
    # Index level, not dollars: used to restate amounts and prices in today's dollars.
    "CPIAUCSL": {"name": "Consumer price index", "unit_scale": 1.0},
}

HISTORY_START = "2016-01-01"

# Futures positioning from the CFTC's weekly Commitments of Traders reports.
# report: "tff" (Traders in Financial Futures: leveraged funds vs asset managers) or
# "disagg" (Disaggregated: managed money), keyed by CFTC contract market code.
POSITIONING = [
    {"key": "sp500", "name": "S&P 500 futures", "report": "tff", "code": "13874A"},
    {"key": "nasdaq", "name": "Nasdaq 100 futures", "report": "tff", "code": "209742"},
    {"key": "ust10", "name": "10-year Treasury futures", "report": "tff", "code": "043602"},
    {"key": "ustbond", "name": "Long Treasury bond futures", "report": "tff", "code": "020601"},
    {"key": "dollar", "name": "US dollar index futures", "report": "tff", "code": "098662"},
    {"key": "bitcoin", "name": "Bitcoin futures", "report": "tff", "code": "133741"},
    {"key": "vix", "name": "VIX futures", "report": "tff", "code": "1170E1"},
    {"key": "yen", "name": "Japanese yen futures", "report": "tff", "code": "097741"},
    {"key": "euro", "name": "Euro futures", "report": "tff", "code": "099741"},
    {"key": "gold", "name": "Gold futures", "report": "disagg", "code": "088691"},
    {"key": "crude", "name": "Crude oil futures", "report": "disagg", "code": "067651"},
]

# Rates and credit backdrop from FRED: series id -> label and unit.
RATES_SERIES = {
    "DTB3": {"name": "3-month T-bill yield", "unit": "pct"},
    "DGS10": {"name": "10-year Treasury yield", "unit": "pct"},
    "T10Y2Y": {"name": "Yield curve (10y minus 2y)", "unit": "pct"},
    "DFII10": {"name": "10-year real yield", "unit": "pct"},
    "BAMLH0A0HYM2": {"name": "High-yield credit spread", "unit": "pct"},
    "NFCI": {"name": "Financial conditions", "unit": "index"},
}

# "Where the money sits": public totals for each asset class (FRED ids -> unit scale to
# USD billions). Quarterly Financial Accounts figures are carried month to month by prices.
POOL_SERIES = {
    "NCBEILQ027S": 1e-3,       # nonfinancial companies' shares, market value (quarterly, $m)
    "BOGZ1LM793164105Q": 1e-3, # financial companies' shares, market value (quarterly, $m)
    "MVMTD027MNFRBDAL": 1.0,   # marketable Treasury debt at market value (Dallas Fed, monthly, $bn)
    "NCBDBIQ027S": 1e-3,       # nonfinancial companies' bonds and notes (quarterly, $m)
    "HNOREMQ027S": 1e-3,       # households' real estate at market value (quarterly, $m)
    "CSUSHPISA": None,         # Case-Shiller national home price index (monthly), carries real estate
}
# Display order of the holdings classes, bottom of the stack first.
POOL_ORDER = ["Stocks", "Real estate", "Bonds", "Cash", "Gold & commodities", "Crypto"]
# Gold ever mined, in tonnes at year end (World Gold Council estimates), and the coins in
# circulation for bitcoin (halving schedule) and ether; values in between are interpolated.
GOLD_TONNES = [("2016-12-31", 187200), ("2017-12-31", 190040), ("2018-12-31", 193472), ("2019-12-31", 197576),
               ("2020-12-31", 201296), ("2021-12-31", 205238), ("2022-12-31", 208874), ("2023-12-31", 212582),
               ("2024-12-31", 216265), ("2028-12-31", 230700)]
BTC_SUPPLY = [("2016-07-09", 15.75e6), ("2020-05-11", 18.375e6), ("2024-04-20", 19.6875e6), ("2028-04-15", 20.34375e6)]
ETH_SUPPLY = [("2017-01-01", 86.6e6), ("2018-01-01", 97.1e6), ("2019-01-01", 104.4e6), ("2020-01-01", 109.4e6),
              ("2021-01-01", 114.1e6), ("2022-01-01", 119.1e6), ("2022-09-15", 120.5e6), ("2024-01-01", 120.2e6),
              ("2026-12-31", 120.7e6)]

# Lookback windows (trading days) for the "where did the money go" view.
FLOW_WINDOWS = [5, 20, 60]

# A selloff is a peak-to-trough fall in the benchmark of at least this much.
SELLOFF_THRESHOLD = 0.07
# Trading days after the trough used to measure the rebound.
REBOUND_DAYS = 20
