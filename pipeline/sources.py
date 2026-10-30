"""Fetchers for free, keyless public data sources.

Every fetcher returns pandas objects indexed by a tz-naive DatetimeIndex and raises
on failure; the build step decides which failures are fatal.
"""

import io
import time

import pandas as pd
import requests

USER_AGENT = "Mozilla/5.0 (liquidity-flow-dashboard; +https://github.com)"
TIMEOUT = 30


def _get(url, params=None, retries=3):
    last = None
    for attempt in range(retries):
        try:
            resp = requests.get(
                url, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
            )
            if resp.status_code == 429 or resp.status_code >= 500:
                raise requests.HTTPError(f"{resp.status_code} from {url}")
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last = exc
            time.sleep(2 ** (attempt + 1))
    raise last


def parse_yahoo_chart(payload):
    """Turn a Yahoo v8 chart response into an OHLCV frame with an adjusted close."""
    result = payload["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    adj = result["indicators"].get("adjclose", [{}])[0].get("adjclose")
    index = pd.to_datetime(result["timestamp"], unit="s").normalize()
    df = pd.DataFrame(
        {
            "open": quote["open"],
            "high": quote["high"],
            "low": quote["low"],
            "close": quote["close"],
            "volume": quote["volume"],
            "adj_close": adj if adj is not None else quote["close"],
        },
        index=index,
        dtype="float64",
    )
    df = df[~df.index.duplicated(keep="last")].dropna(subset=["close"])
    df.index.name = "date"
    return df


def volume_to_units(df):
    """Convert a USD-denominated volume column to units so close * volume is dollar volume."""
    df = df.copy()
    df["volume"] = df["volume"] / df["close"]
    return df


def fetch_yahoo(ticker, start):
    period1 = int(pd.Timestamp(start).timestamp())
    period2 = int(time.time())
    params = {"period1": period1, "period2": period2, "interval": "1d", "events": "div,split"}
    last = None
    for host in ("query1", "query2"):
        try:
            url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{ticker}"
            return parse_yahoo_chart(_get(url, params).json())
        except (requests.RequestException, KeyError, IndexError, TypeError) as exc:
            last = exc
    raise RuntimeError(f"Yahoo fetch failed for {ticker}: {last}")


def parse_stooq_csv(text):
    df = pd.read_csv(io.StringIO(text), parse_dates=["Date"], index_col="Date")
    df.columns = [c.lower() for c in df.columns]
    df["adj_close"] = df["close"]  # stooq prices are already split/dividend adjusted
    df.index.name = "date"
    return df[["open", "high", "low", "close", "volume", "adj_close"]].astype("float64")


def fetch_stooq(symbol, start):
    resp = _get("https://stooq.com/q/d/l/", {"s": symbol, "i": "d"})
    df = parse_stooq_csv(resp.text)
    return df[df.index >= pd.Timestamp(start)]


def parse_fred_csv(text):
    df = pd.read_csv(io.StringIO(text))
    date_col = df.columns[0]
    value_col = df.columns[1]
    series = pd.to_numeric(df[value_col], errors="coerce")
    series.index = pd.to_datetime(df[date_col])
    series.index.name = "date"
    return series.dropna()


def fetch_fred(series_id, start):
    resp = _get("https://fred.stlouisfed.org/graph/fredgraph.csv", {"id": series_id, "cosd": start})
    return parse_fred_csv(resp.text)


def parse_defillama_stablecoins(payload):
    rows = {
        pd.to_datetime(int(row["date"]), unit="s"): row["totalCirculatingUSD"].get("peggedUSD", 0.0)
        for row in payload
    }
    series = pd.Series(rows, dtype="float64").sort_index() / 1e9
    series.index.name = "date"
    return series


def fetch_stablecoin_supply():
    """Total USD-pegged stablecoin supply in billions (DefiLlama)."""
    return parse_defillama_stablecoins(_get("https://stablecoins.llama.fi/stablecoincharts/all").json())


SSGA_NAV_HISTORY = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/navhist-us-en-{}.xlsx"


def parse_ssga_nav_history(content):
    """State Street's NAV history workbook -> daily nav, shares and aum (USD), oldest first.

    The sheet opens with a few lines of fund details, then a Date / NAV / Shares
    Outstanding / Total Net Assets table, then disclaimers; only the table is kept.
    """
    import openpyxl

    ws = openpyxl.load_workbook(io.BytesIO(content), read_only=True).worksheets[0]
    rows, header = [], None
    for row in ws.iter_rows(values_only=True):
        if header is None:
            if row and row[0] == "Date":
                header = [str(c).strip() if c is not None else "" for c in row]
            continue
        cell = row[0] if row else None
        if isinstance(cell, str):
            date = pd.to_datetime(cell.strip(), format="%d-%b-%Y", errors="coerce")
        else:
            date = pd.Timestamp(cell) if hasattr(cell, "year") else pd.NaT
        if pd.isna(date):
            if rows:
                break
            continue
        rows.append((date, row[header.index("NAV")], row[header.index("Shares Outstanding")],
                     row[header.index("Total Net Assets")]))
    if not rows:
        raise ValueError("no NAV history table found")
    df = pd.DataFrame(rows, columns=["date", "nav", "shares", "aum"]).set_index("date").sort_index()
    df = df[~df.index.duplicated(keep="last")].apply(pd.to_numeric, errors="coerce").dropna()
    return df


def fetch_ssga(code):
    return parse_ssga_nav_history(_get(SSGA_NAV_HISTORY.format(code)).content)


CFTC_DATASETS = {"tff": "gpe5-46if", "disagg": "72hh-3qpy"}
CFTC_FIELDS = {
    "tff": {"lev_long": "lev_money_positions_long", "lev_short": "lev_money_positions_short",
            "am_long": "asset_mgr_positions_long", "am_short": "asset_mgr_positions_short"},
    "disagg": {"lev_long": "m_money_positions_long_all", "lev_short": "m_money_positions_short_all"},
}


def parse_cftc(rows, report):
    """CFTC Socrata rows -> weekly frame of speculative (and asset manager) net positions."""
    fields = CFTC_FIELDS[report]
    df = pd.DataFrame(rows)
    out = pd.DataFrame(index=pd.to_datetime(df["report_date_as_yyyy_mm_dd"]).dt.normalize())
    num = lambda col: pd.to_numeric(df[col], errors="coerce").to_numpy()  # noqa: E731
    out["spec_net"] = num(fields["lev_long"]) - num(fields["lev_short"])
    if "am_long" in fields:
        out["am_net"] = num(fields["am_long"]) - num(fields["am_short"])
    out["open_interest"] = num("open_interest_all")
    out.index.name = "date"
    return out[~out.index.duplicated(keep="last")].sort_index()


def fetch_cftc(report, code, start):
    fields = ["report_date_as_yyyy_mm_dd", "open_interest_all", *CFTC_FIELDS[report].values()]
    params = {
        "$select": ",".join(fields),
        "$where": f"cftc_contract_market_code='{code}' AND report_date_as_yyyy_mm_dd >= '{start}'",
        "$order": "report_date_as_yyyy_mm_dd",
        "$limit": 5000,
    }
    rows = _get(f"https://publicreporting.cftc.gov/resource/{CFTC_DATASETS[report]}.json", params).json()
    if not rows:
        raise ValueError(f"no CFTC rows for {code}")
    return parse_cftc(rows, report)
