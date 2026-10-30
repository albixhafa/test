"""Pure analytics: turn raw prices and macro series into dashboard-ready numbers.

Nothing here can observe real fund flows (that needs paid creation/redemption data).
Flows are *estimated* with Chaikin money flow: each day's dollar volume is signed by
where the close landed inside the day's range, so heavy volume closing near the low
counts as selling pressure and heavy volume closing near the high as buying pressure.
"""

import numpy as np
import pandas as pd

CASH_NODE = "Cash & sidelines"


def money_flow(df):
    """Daily signed dollar flow (USD) from an OHLCV frame."""
    span = df["high"] - df["low"]
    clv = ((df["close"] - df["low"]) - (df["high"] - df["close"])) / span
    clv = clv.where(span > 0, 0.0).fillna(0.0).clip(-1, 1)
    return df["close"] * df["volume"].fillna(0.0) * clv


def align_to_calendar(prices, calendar):
    """Project each asset onto the benchmark trading calendar.

    Prices are forward-filled; flows and dollar volume from non-trading days (crypto
    weekends) are rolled into the next trading day so nothing is dropped.
    Returns a dict of DataFrames (columns = tickers): close, flow, dollar_volume.
    """
    calendar = pd.DatetimeIndex(calendar)
    close, flow, dvol = {}, {}, {}
    for ticker, df in prices.items():
        df = df.sort_index()
        close[ticker] = df["adj_close"].reindex(calendar.union(df.index)).ffill().reindex(calendar)
        pos = calendar.searchsorted(df.index, side="left")
        keep = pos < len(calendar)
        bucket = calendar[pos[keep]]
        flow[ticker] = money_flow(df)[keep].groupby(bucket).sum().reindex(calendar, fill_value=0.0)
        dv = (df["close"] * df["volume"].fillna(0.0))[keep]
        dvol[ticker] = dv.groupby(bucket).sum().reindex(calendar, fill_value=0.0)
    return {
        "close": pd.DataFrame(close),
        "flow": pd.DataFrame(flow),
        "dollar_volume": pd.DataFrame(dvol),
    }


def window_flows(panel, window, baseline=60):
    """Per-asset return, estimated net flow and volume surge over the last `window` days."""
    close, flow, dvol = panel["close"], panel["flow"], panel["dollar_volume"]
    if len(close) < window + baseline + 1:
        raise ValueError("not enough history for window")
    recent = slice(-window, None)
    base = slice(-(window + baseline), -window)
    rows = {}
    for ticker in close.columns:
        start_px, end_px = close[ticker].iloc[-window - 1], close[ticker].iloc[-1]
        base_dv = dvol[ticker].iloc[base].mean()
        net = flow[ticker].iloc[recent].sum()
        rows[ticker] = {
            "ret": _num(end_px / start_px - 1),
            "net_flow_bn": _num(net / 1e9),
            # Net flow as a share of the dollar volume a normal window would trade.
            "intensity": _num(net / (base_dv * window)) if base_dv > 0 else None,
            "volume_ratio": _num(dvol[ticker].iloc[recent].mean() / base_dv) if base_dv > 0 else None,
        }
    return {
        "start": close.index[-window - 1].strftime("%Y-%m-%d"),
        "end": close.index[-1].strftime("%Y-%m-%d"),
        "assets": rows,
    }


def allocate_flows(net, min_share=0.002):
    """Build Sankey links from net outflows to net inflows.

    Each outflow is split across inflows in proportion to their size. Whatever the
    inflows cannot absorb is routed to a cash node; if inflows exceed outflows the
    difference is drawn from that same cash node. This is an allocation model for
    reading the rotation, not a record of who bought from whom.
    """
    sources = {k: -v for k, v in net.items() if v is not None and v < 0}
    sinks = {k: v for k, v in net.items() if v is not None and v > 0}
    total_out, total_in = sum(sources.values()), sum(sinks.values())
    links = []
    if total_out > 0 and total_in > 0:
        matched = min(total_out, total_in)
        for s, out in sources.items():
            for d, inn in sinks.items():
                value = matched * (out / total_out) * (inn / total_in)
                links.append({"source": s, "target": d, "value": value})
    if total_out > total_in:
        for s, out in sources.items():
            links.append({"source": s, "target": CASH_NODE, "value": (total_out - total_in) * out / total_out})
    elif total_in > total_out:
        for d, inn in sinks.items():
            links.append({"source": CASH_NODE, "target": d, "value": (total_in - total_out) * inn / total_in})
    scale = max(total_out, total_in, 1e-12)
    links = [l for l in links if l["value"] / scale >= min_share]
    for l in links:
        l["value"] = round(l["value"], 4)
    return {
        "links": links,
        "total_out_bn": round(total_out, 4),
        "total_in_bn": round(total_in, 4),
    }


def class_flows(asset_net, asset_group, groups, cash_group):
    """Net flow per asset class and the class-to-class links for the liquidity wheel.

    Asset flows are summed within each class, so rotation inside a class (S&P 500 into
    utilities, say) cancels out. Cash is the balancing account: its net is minus the
    sum of every other class, so the wheel always balances and money that left the
    tracked markets shows up as flowing into cash.
    """
    net = {g: 0.0 for g in groups}
    for ticker, value in asset_net.items():
        group = asset_group.get(ticker)
        if value is None or group is None or group == cash_group:
            continue
        net[group] += value
    net[cash_group] = -sum(v for g, v in net.items() if g != cash_group)
    alloc = allocate_flows(net)
    links = [l for l in alloc["links"] if CASH_NODE not in (l["source"], l["target"])]
    return {
        "net": {g: round(v, 4) for g, v in net.items()},
        "links": links,
        "total_bn": round(sum(l["value"] for l in links), 4),
    }


def find_selloffs(close, threshold):
    """Zig-zag swing detection: peak-to-trough falls of at least `threshold`.

    A trough is confirmed once price rebounds `threshold` off it; an unconfirmed
    decline still in progress is returned with ongoing=True.
    """
    close = close.dropna()
    values, dates = close.to_numpy(), close.index
    episodes = []
    if len(values) < 2:
        return episodes

    def make(p, t, ongoing):
        return {
            "peak": dates[p].strftime("%Y-%m-%d"),
            "trough": dates[t].strftime("%Y-%m-%d"),
            "drawdown": _num(values[t] / values[p] - 1),
            "days": int(t - p),
            "ongoing": ongoing,
        }

    peak, trough, falling = 0, 0, False
    for i in range(1, len(values)):
        if not falling:
            if values[i] > values[peak]:
                peak = i
            elif values[i] / values[peak] - 1 <= -threshold:
                falling, trough = True, i
        else:
            if values[i] < values[trough]:
                trough = i
            elif values[i] / values[trough] - 1 >= threshold:
                episodes.append(make(peak, trough, False))
                falling, peak = False, i
    if falling:
        episodes.append(make(peak, trough, True))
    return episodes


def _asof_change(series, start, end):
    if series is None or series.empty:
        return None
    a, b = series.asof(pd.Timestamp(start)), series.asof(pd.Timestamp(end))
    if pd.isna(a) or pd.isna(b):
        return None
    return _num(b - a)


def selloff_stats(panel, episodes, rebound_days, cash_series):
    """Attach per-asset behaviour and cash-bucket changes to each selloff."""
    close, flow, dvol = panel["close"], panel["flow"], panel["dollar_volume"]
    idx = close.index
    out = []
    for ep in episodes:
        p, t = idx.get_loc(pd.Timestamp(ep["peak"])), idx.get_loc(pd.Timestamp(ep["trough"]))
        r = t + rebound_days
        assets = {}
        for ticker in close.columns:
            c = close[ticker]
            base_dv = dvol[ticker].iloc[max(0, p - 60):p].mean()
            during_dv = dvol[ticker].iloc[p + 1:t + 1].mean()
            net = flow[ticker].iloc[p + 1:t + 1].sum()
            assets[ticker] = {
                "ret": _num(c.iloc[t] / c.iloc[p] - 1),
                "rebound": _num(c.iloc[r] / c.iloc[t] - 1) if r < len(c) else None,
                "volume_ratio": _num(during_dv / base_dv) if base_dv > 0 else None,
                "net_flow_bn": _num(net / 1e9),
            }
        cash = {k: _asof_change(s, ep["peak"], ep["trough"]) for k, s in cash_series.items()}
        out.append({**ep, "assets": assets, "cash": cash})
    return out


def playbook(episodes, tickers):
    """Summarise how each asset behaved across completed selloffs."""
    done = [e for e in episodes if not e["ongoing"]]
    rows = []
    for ticker in tickers:
        rets = [e["assets"][ticker]["ret"] for e in done if e["assets"][ticker]["ret"] is not None]
        rebounds = [e["assets"][ticker]["rebound"] for e in done if e["assets"][ticker]["rebound"] is not None]
        vols = [e["assets"][ticker]["volume_ratio"] for e in done if e["assets"][ticker]["volume_ratio"] is not None]
        if not rets:
            continue
        rows.append({
            "ticker": ticker,
            "episodes": len(rets),
            "median_ret": _num(np.median(rets)),
            "hit_rate": _num(np.mean([x > 0 for x in rets])),
            "median_rebound": _num(np.median(rebounds)) if rebounds else None,
            "median_volume_ratio": _num(np.median(vols)) if vols else None,
        })
    return sorted(rows, key=lambda r: r["median_ret"], reverse=True)


def risk_appetite(close, vix=None, lookback=20, zwindow=252):
    """Composite risk-on/risk-off score: mean z-score of risk-seeking signals."""
    ret = close.pct_change(lookback, fill_method=None)
    parts = {}
    if "SPY" in ret:
        parts["Equities"] = ret["SPY"]
    if {"IWM", "SPY"} <= set(ret.columns):
        parts["Small vs large caps"] = ret["IWM"] - ret["SPY"]
    if {"HYG", "IEF"} <= set(ret.columns):
        parts["Credit vs Treasuries"] = ret["HYG"] - ret["IEF"]
    if "BTC-USD" in ret:
        parts["Bitcoin"] = ret["BTC-USD"]
    if "UUP" in ret:
        parts["Dollar (inverted)"] = -ret["UUP"]
    if vix is not None:
        parts["Volatility (inverted)"] = -vix.reindex(close.index).ffill()
    z = pd.DataFrame({
        k: (s - s.rolling(zwindow, min_periods=60).mean()) / s.rolling(zwindow, min_periods=60).std()
        for k, s in parts.items()
    })
    score = z.mean(axis=1, skipna=True)
    return score, z


def regime_label(score):
    if score is None or np.isnan(score):
        return "Unknown"
    if score >= 0.5:
        return "Risk-on"
    if score <= -0.5:
        return "Risk-off"
    return "Neutral"


def rolling_correlation(close, benchmark, tickers, window=60):
    ret = close.pct_change(fill_method=None)
    return pd.DataFrame({t: ret[t].rolling(window).corr(ret[benchmark]) for t in tickers if t in ret})


def net_liquidity(fed_assets, tga, rrp):
    """Fed balance sheet minus TGA minus reverse repo, all in USD billions, weekly."""
    if fed_assets is None or tga is None or rrp is None:
        return None
    dates = fed_assets.index
    tga_w = tga.reindex(dates.union(tga.index)).ffill().reindex(dates)
    rrp_w = rrp.reindex(dates.union(rrp.index)).ffill().reindex(dates)
    return (fed_assets - tga_w - rrp_w).dropna()


def _num(x, digits=6):
    if x is None:
        return None
    x = float(x)
    if not np.isfinite(x):
        return None
    return round(x, digits)
