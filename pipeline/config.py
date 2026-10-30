"""Universe definition: which markets we track and which macro series describe cash."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Asset:
    ticker: str  # Yahoo Finance symbol
    name: str
    group: str
    stooq: str | None = None  # fallback symbol on stooq.com (ETFs only)
    usd_volume: bool = False  # Yahoo reports volume in USD rather than units (crypto pairs)


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
    Asset("QQQ", "Nasdaq 100", "Stocks", "qqq.us"),
    Asset("IWM", "Small caps", "Stocks", "iwm.us"),
    Asset("EFA", "Intl developed", "Stocks", "efa.us"),
    Asset("EEM", "Emerging markets", "Stocks", "eem.us"),
    Asset("XLP", "Consumer staples", "Stocks", "xlp.us"),
    Asset("XLU", "Utilities", "Stocks", "xlu.us"),
    Asset("BIL", "T-bills (cash)", "Cash", "bil.us"),
    Asset("IEF", "7-10y Treasuries", "Bonds", "ief.us"),
    Asset("TLT", "20y+ Treasuries", "Bonds", "tlt.us"),
    Asset("LQD", "IG corporate", "Bonds", "lqd.us"),
    Asset("HYG", "High yield", "Bonds", "hyg.us"),
    Asset("GLD", "Gold", "Gold & commodities", "gld.us"),
    Asset("DBC", "Commodities", "Gold & commodities", "dbc.us"),
    Asset("UUP", "US dollar", "US dollar", "uup.us"),
    Asset("BTC-USD", "Bitcoin", "Crypto", usd_volume=True),
    Asset("ETH-USD", "Ether", "Crypto", usd_volume=True),
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
}

HISTORY_START = "2016-01-01"

# Lookback windows (trading days) for the "where did the money go" view.
FLOW_WINDOWS = [5, 20, 60]

# A selloff is a peak-to-trough fall in the benchmark of at least this much.
SELLOFF_THRESHOLD = 0.07
# Trading days after the trough used to measure the rebound.
REBOUND_DAYS = 20
