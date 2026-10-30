"""Universe definition: which markets we track and which macro series describe cash."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Asset:
    ticker: str  # Yahoo Finance symbol
    name: str
    group: str
    stooq: str | None = None  # fallback symbol on stooq.com (ETFs only)


# Groups are listed in display order; the dashboard assigns colours by this order.
GROUPS = [
    "Equities",
    "Defensive equities",
    "Treasuries & cash",
    "Credit",
    "Real assets",
    "US dollar",
    "Crypto",
]

ASSETS = [
    Asset("SPY", "S&P 500", "Equities", "spy.us"),
    Asset("QQQ", "Nasdaq 100", "Equities", "qqq.us"),
    Asset("IWM", "Small caps", "Equities", "iwm.us"),
    Asset("EFA", "Intl developed", "Equities", "efa.us"),
    Asset("EEM", "Emerging markets", "Equities", "eem.us"),
    Asset("XLP", "Consumer staples", "Defensive equities", "xlp.us"),
    Asset("XLU", "Utilities", "Defensive equities", "xlu.us"),
    Asset("BIL", "T-bills (cash)", "Treasuries & cash", "bil.us"),
    Asset("IEF", "7-10y Treasuries", "Treasuries & cash", "ief.us"),
    Asset("TLT", "20y+ Treasuries", "Treasuries & cash", "tlt.us"),
    Asset("LQD", "IG corporate", "Credit", "lqd.us"),
    Asset("HYG", "High yield", "Credit", "hyg.us"),
    Asset("GLD", "Gold", "Real assets", "gld.us"),
    Asset("DBC", "Commodities", "Real assets", "dbc.us"),
    Asset("UUP", "US dollar", "US dollar", "uup.us"),
    Asset("BTC-USD", "Bitcoin", "Crypto"),
    Asset("ETH-USD", "Ether", "Crypto"),
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
