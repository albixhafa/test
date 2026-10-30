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


# Asset classes, in display order; the dashboard assigns colours by this order and
# the liquidity wheel draws one arc per class.
GROUPS = [
    "Stocks",
    "Bonds",
    "Cash",
    "Gold & commodities",
    "Crypto",
    "US dollar",
]
# The wheel treats cash as the balancing account: whatever is sold and not bought
# elsewhere among the tracked markets is counted as moving to cash, and vice versa.
CASH_GROUP = "Cash"

ASSETS = [
    Asset("SPY", "S&P 500", "Stocks", "spy.us"),
    Asset("QQQ", "Nasdaq 100", "Stocks", "qqq.us", short="Nasdaq"),
    Asset("IWM", "Small caps", "Stocks", "iwm.us"),
    Asset("EFA", "International stocks", "Stocks", "efa.us", short="Intl"),
    Asset("EEM", "Emerging markets", "Stocks", "eem.us", short="EM"),
    Asset("XLP", "Consumer staples", "Stocks", "xlp.us", short="Staples"),
    Asset("XLU", "Utilities", "Stocks", "xlu.us"),
    Asset("BIL", "T-bills (cash)", "Cash", "bil.us", short="T-bills"),
    Asset("IEF", "10-year Treasuries", "Bonds", "ief.us", short="10y bonds"),
    Asset("TLT", "Long Treasuries (20y+)", "Bonds", "tlt.us", short="Long bonds"),
    Asset("LQD", "Corporate bonds", "Bonds", "lqd.us", short="Corp bonds"),
    Asset("HYG", "High-yield bonds", "Bonds", "hyg.us", short="Junk bonds"),
    Asset("GLD", "Gold", "Gold & commodities", "gld.us"),
    Asset("DBC", "Commodities", "Gold & commodities", "dbc.us", short="Commod."),
    Asset("UUP", "US dollar", "US dollar", "uup.us", short="Dollar"),
    Asset("BTC-USD", "Bitcoin", "Crypto", usd_volume=True, short="Bitcoin"),
    Asset("ETH-USD", "Ether", "Crypto", usd_volume=True, short="Ether"),
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

# Lookback windows (trading days) for the "where did the money go" view.
FLOW_WINDOWS = [5, 20, 60]

# A selloff is a peak-to-trough fall in the benchmark of at least this much.
SELLOFF_THRESHOLD = 0.07
# Trading days after the trough used to measure the rebound.
REBOUND_DAYS = 20
