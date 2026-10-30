"""Pure analytics: turn prices, fund data and macro series into dashboard-ready numbers.

Flows are real money: for each fund, the day's change in shares outstanding times its
net asset value (creations minus redemptions, in dollars). Crypto flows are the change
in total stablecoin supply, the dollars entering or leaving crypto rails.
"""

import numpy as np
import pandas as pd

BALANCE_NODE = "Sidelines"


def _bucket(index, calendar):
    """Map each date to the first calendar day on or after it (None past the end)."""
    pos = calendar.searchsorted(index, side="left")
    keep = pos < len(calendar)
    return keep, calendar[pos[keep]]


def align_to_calendar(prices, calendar):
    """Project each asset's prices onto the benchmark trading calendar.

    Prices are forward-filled; dollar volume from non-trading days (crypto weekends) is
    rolled into the next trading day so nothing is dropped.
    Returns a dict of DataFrames (columns = tickers): close, dollar_volume.
    """
    calendar = pd.DatetimeIndex(calendar)
    close, dvol = {}, {}
    for ticker, df in prices.items():
        df = df.sort_index()
        close[ticker] = df["adj_close"].reindex(calendar.union(df.index)).ffill().reindex(calendar)
        keep, bucket = _bucket(df.index, calendar)
        dv = (df["close"] * df["volume"].fillna(0.0))[keep]
        dvol[ticker] = dv.groupby(bucket).sum().reindex(calendar, fill_value=0.0)
    return {"close": pd.DataFrame(close), "dollar_volume": pd.DataFrame(dvol)}


def fund_flows(nav_history):
    """Daily net flow (USD) from a fund's shares outstanding: new shares x NAV.

    `nav_history` has nav, shares and aum columns. The first day has no prior count, so
    its flow is NaN.
    """
    df = nav_history.sort_index()
    df = df[(df["shares"] > 0) & (df["nav"] > 0)]
    change = df["shares"].diff()
    # A day where the share count jumps or collapses by half or more is a split or a
    # reporting glitch, not money: count it as no flow.
    ratio = df["shares"] / df["shares"].shift(1)
    change = change.where((ratio > 0.5) & (ratio < 1.5), 0.0)
    change.iloc[0] = np.nan
    return change * df["nav"]


def supply_flows(supply_bn):
    """Daily net flow (USD) from a supply series in USD billions (stablecoins)."""
    return supply_bn.sort_index().diff() * 1e9


def align_flows(flows, sizes, calendar):
    """Put daily flows and fund sizes (USD) on the trading calendar.

    Flows dated on non-trading days are rolled into the next trading day; sizes are
    forward-filled. Before a fund's first report both stay NaN, so "no data" never
    reads as "no flow". Returns {"flow": DataFrame, "aum": DataFrame}.
    """
    calendar = pd.DatetimeIndex(calendar)
    flow, aum = {}, {}
    for ticker, f in flows.items():
        f = f.dropna()
        keep, bucket = _bucket(f.index, calendar)
        col = f[keep].groupby(bucket).sum().reindex(calendar)
        first = f.index.min() if len(f) else None
        if first is not None:
            col = col.where(calendar < first, col.fillna(0.0))
        flow[ticker] = col
        s = sizes[ticker].sort_index()
        aum[ticker] = s.reindex(calendar.union(s.index)).ffill().reindex(calendar)
    return {"flow": pd.DataFrame(flow), "aum": pd.DataFrame(aum)}


def window_flows(panel, window, baseline=60):
    """Per-asset return, net flow and flow as a share of fund size over the last `window` days.

    Markets without flow data get net_flow_bn = None.
    """
    close, dvol = panel["close"], panel["dollar_volume"]
    flow, aum = panel["flow"], panel["aum"]
    if len(close) < window + baseline + 1:
        raise ValueError("not enough history for window")
    recent = slice(-window, None)
    base = slice(-(window + baseline), -window)
    rows = {}
    for ticker in close.columns:
        start_px, end_px = close[ticker].iloc[-window - 1], close[ticker].iloc[-1]
        base_dv = dvol[ticker].iloc[base].mean() if ticker in dvol else None
        row = {"ret": _num(end_px / start_px - 1), "net_flow_bn": None, "intensity": None}
        if ticker in flow and flow[ticker].iloc[recent].notna().any():
            net = flow[ticker].iloc[recent].sum()
            size = aum[ticker].iloc[-window - 1]
            row["net_flow_bn"] = _num(net / 1e9)
            # Net flow as a share of the fund's size at the start of the window.
            row["intensity"] = _num(net / size) if size and size > 0 else None
        row["volume_ratio"] = _num(dvol[ticker].iloc[recent].mean() / base_dv) if base_dv else None
        rows[ticker] = row
    return {
        "start": close.index[-window - 1].strftime("%Y-%m-%d"),
        "end": close.index[-1].strftime("%Y-%m-%d"),
        "assets": rows,
    }


def allocate_flows(net, min_share=0.002):
    """Build Sankey links from net outflows to net inflows.

    Each outflow is split across inflows in proportion to their size. Whatever the
    inflows cannot absorb is routed to the sidelines node; if inflows exceed outflows
    the difference is drawn from it. This is an allocation model for reading the
    rotation, not a record of who bought from whom.
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
            links.append({"source": s, "target": BALANCE_NODE, "value": (total_out - total_in) * out / total_out})
    elif total_in > total_out:
        for d, inn in sinks.items():
            links.append({"source": BALANCE_NODE, "target": d, "value": (total_in - total_out) * inn / total_in})
    scale = max(total_out, total_in, 1e-12)
    links = [l for l in links if l["value"] / scale >= min_share]
    for l in links:
        l["value"] = round(l["value"], 4)
    return {
        "links": links,
        "total_out_bn": round(total_out, 4),
        "total_in_bn": round(total_in, 4),
    }


def class_flows(asset_net, asset_group, groups, balance_group):
    """Net flow per asset class and the class-to-class links for the liquidity wheel.

    Asset flows are summed within each class, so rotation inside a class (S&P 500 into
    utilities, say) cancels out. The balance group holds no markets: its net is minus
    the sum of every class, so money that entered the tracked funds from outside shows
    as leaving the sidelines, and money that left them shows as going to the sidelines.
    """
    net = {g: 0.0 for g in groups}
    for ticker, value in asset_net.items():
        group = asset_group.get(ticker)
        if value is None or group is None or group == balance_group or not np.isfinite(value):
            continue
        net[group] += value
    net[balance_group] = -sum(v for g, v in net.items() if g != balance_group)
    # The nets now sum to zero, so every link runs between two groups.
    links = allocate_flows(net)["links"]
    return {
        "net": {g: round(v, 4) for g, v in net.items()},
        "links": links,
        "total_bn": round(sum(l["value"] for l in links), 4),
    }


def periodic_class_flows(flow, asset_group, groups, balance_group, freq, periods=None):
    """Class-to-class flows for each calendar period (weekly, monthly) of daily asset flows.

    `flow` holds daily flows in USD (columns = tickers). Each period is labelled
    by its first and last trading day, so a week still in progress ends on the latest day.
    Returns a compact dict: parallel lists of start/end dates, net per class, total moved,
    and links as [source index, target index, USD billions] triples.
    """
    flow = flow.dropna(how="all")
    days = flow.index.to_series()
    sums = flow.resample(freq).sum() / 1e9
    first = days.resample(freq).min()
    last = days.resample(freq).max()
    keep = last.notna()
    sums, first, last = sums[keep], first[keep], last[keep]
    if periods:
        sums, first, last = sums.iloc[-periods:], first.iloc[-periods:], last.iloc[-periods:]
    index = {g: i for i, g in enumerate(groups)}
    out = {"start": [], "end": [], "net": {g: [] for g in groups}, "total": [], "links": []}
    for (label, row), a, b in zip(sums.iterrows(), first, last):
        wheel = class_flows(row.to_dict(), asset_group, groups, balance_group)
        out["start"].append(a.strftime("%Y-%m-%d"))
        out["end"].append(b.strftime("%Y-%m-%d"))
        for g in groups:
            out["net"][g].append(round(wheel["net"][g], 3))
        out["total"].append(round(wheel["total_bn"], 3))
        out["links"].append([[index[l["source"]], index[l["target"]], round(l["value"], 3)] for l in wheel["links"]])
    return out


def flow_streaks(weekly_net, lookback=8):
    """Persistence of flows over the last `lookback` weeks for each column.

    Returns inflow week count, total, and the change between the most recent half of
    the window and the half before it (positive = buying is accelerating).
    """
    out = {}
    half = lookback // 2
    for col in weekly_net.columns:
        s = weekly_net[col].dropna().iloc[-lookback:]
        if len(s) < lookback:
            continue
        out[col] = {
            "inflow_weeks": int((s > 0).sum()),
            "weeks": int(len(s)),
            "total_bn": _num(s.sum(), 3),
            "recent_bn": _num(s.iloc[-half:].sum(), 3),
            "prior_bn": _num(s.iloc[:-half].sum(), 3),
        }
    return out


def pack_columns(df, sig=6):
    """Columns as plain lists for JSON, rounded to `sig` significant digits, NaN as None."""
    def num(v):
        return None if v is None or not np.isfinite(v) else float(f"{v:.{sig}g}")
    return {col: [num(v) for v in df[col].to_numpy(dtype="float64")] for col in df.columns}


def range_series(flow, aum, close, daily_days=756, monthly_from="2017-01-01"):
    """Per-market series the dashboard aggregates for any date range the viewer picks.

    Daily rows for the last `daily_days` trading days, and monthly rows (summed flow,
    fund size on the first day, last close) since `monthly_from`. Flow and fund size are
    in USD billions and cover markets with flow data; closes cover every market. Each
    monthly row carries its first and last trading day.
    """
    d = slice(-daily_days, None)
    daily = {
        "dates": [x.strftime("%Y-%m-%d") for x in close.index[d]],
        "flow": pack_columns(flow.iloc[d] / 1e9, 4),
        "aum": pack_columns(aum.iloc[d] / 1e9, 4),
        "close": pack_columns(close.iloc[d]),
    }
    keep = close.index >= pd.Timestamp(monthly_from)
    f, a, c = flow[keep], aum[keep], close[keep]
    days = c.index.to_series()
    first, last = days.resample("ME").min().dropna(), days.resample("ME").max().dropna()
    monthly = {
        "start": [x.strftime("%Y-%m-%d") for x in first],
        "end": [x.strftime("%Y-%m-%d") for x in last],
        "flow": pack_columns((f.resample("ME").sum(min_count=1) / 1e9).loc[first.index], 4),
        "aum": pack_columns((a.resample("ME").first() / 1e9).loc[first.index], 4),
        "close": pack_columns(c.resample("ME").last().loc[first.index]),
    }
    return {"daily": daily, "monthly": monthly}


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
    close, flow, dvol, aum = panel["close"], panel["flow"], panel["dollar_volume"], panel["aum"]
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
            f = flow[ticker].iloc[p + 1:t + 1] if ticker in flow else None
            has_flow = f is not None and f.notna().any()
            size = aum[ticker].iloc[p] if has_flow else None
            assets[ticker] = {
                "ret": _num(c.iloc[t] / c.iloc[p] - 1),
                "rebound": _num(c.iloc[r] / c.iloc[t] - 1) if r < len(c) else None,
                "volume_ratio": _num(during_dv / base_dv) if base_dv > 0 else None,
                "net_flow_bn": _num(f.sum() / 1e9) if has_flow else None,
                # Net flow as a share of the fund's size at the peak.
                "flow_pct": _num(f.sum() / size) if has_flow and size and size > 0 else None,
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
    if {"JNK", "SPTI"} <= set(ret.columns):
        parts["Credit vs Treasuries"] = ret["JNK"] - ret["SPTI"]
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


def positioning_summary(frame, years=3):
    """Weekly net positions plus where the latest sits in its own recent history.

    `frame` has spec_net (leveraged funds or managed money), optional am_net (asset
    managers) and open_interest. The percentile compares the latest speculative net
    position with the last `years` of weekly readings; 100 means the most bullish
    (longest) in that window, 0 the most bearish.
    """
    f = frame.dropna(subset=["spec_net"])
    if f.empty:
        return None
    recent = f["spec_net"][f.index > f.index[-1] - pd.DateOffset(years=years)]
    latest = f["spec_net"].iloc[-1]
    pct = float((recent < latest).mean() + 0.5 * (recent == latest).mean()) * 100
    out = {
        "dates": [d.strftime("%Y-%m-%d") for d in f.index],
        "spec_net": [_num(v, 0) for v in f["spec_net"]],
        "open_interest": [_num(v, 0) for v in f["open_interest"]],
        "latest": _num(latest, 0),
        "change_1w": _num(latest - f["spec_net"].iloc[-2], 0) if len(f) > 1 else None,
        "pct_of_oi": _num(latest / f["open_interest"].iloc[-1], 4) if f["open_interest"].iloc[-1] else None,
        "percentile": _num(pct, 1),
    }
    if "am_net" in f:
        out["am_net"] = [_num(v, 0) for v in f["am_net"]]
    return out


def mmf_flows(assets_bn, bill_yield_pct):
    """Estimated monthly net flows into money market funds, in USD billions.

    Fund assets grow from interest as well as new money, so each month's change is
    reduced by the income the prior month's assets would have earned at that month's
    average 3-month T-bill yield. What is left approximates net new money.
    """
    assets = assets_bn.dropna().sort_index()
    if len(assets) < 2:
        return pd.Series(dtype="float64")
    monthly_yield = bill_yield_pct.dropna().resample("ME").mean().reindex(assets.index, method="ffill") if bill_yield_pct is not None else None
    prev = assets.shift(1)
    income = prev * (monthly_yield / 100 / 12) if monthly_yield is not None else 0.0
    return (assets - prev - income).dropna()


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
