"""Build docs/data/dashboard.json.

    python -m pipeline.build          # live data from Yahoo, Stooq, FRED and DefiLlama
    python -m pipeline.build --demo   # synthetic data, no network
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import analytics as an
from .config import (ASSETS, BENCHMARK, CASH_GROUP, FLOW_WINDOWS, FRED_SERIES, GROUPS,
                     HISTORY_START, REBOUND_DAYS, SELLOFF_THRESHOLD, VIX)

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "dashboard.json"

SOURCES = [
    {"name": "Yahoo Finance", "detail": "Daily OHLCV for ETFs and crypto (Stooq as fallback)"},
    {"name": "FRED", "detail": "Fed balance sheet, TGA, reverse repo, retail money funds, M2"},
    {"name": "DefiLlama", "detail": "Total USD stablecoin supply"},
]


def collect_live(log):
    from . import sources

    prices = {}
    for asset in ASSETS:
        try:
            prices[asset.ticker] = sources.fetch_yahoo(asset.ticker, HISTORY_START)
            if asset.usd_volume:
                prices[asset.ticker] = sources.volume_to_units(prices[asset.ticker])
        except Exception as exc:  # noqa: BLE001 - try the fallback, then record and move on
            if asset.stooq:
                try:
                    prices[asset.ticker] = sources.fetch_stooq(asset.stooq, HISTORY_START)
                    log.append(f"{asset.ticker}: Yahoo failed, used Stooq ({exc})")
                    continue
                except Exception as exc2:  # noqa: BLE001
                    exc = exc2
            log.append(f"{asset.ticker}: no data ({exc})")
    try:
        vix = sources.fetch_yahoo(VIX, HISTORY_START)["close"]
    except Exception as exc:  # noqa: BLE001
        vix = None
        log.append(f"VIX: no data ({exc})")

    macro = {}
    for sid in FRED_SERIES:
        try:
            macro[sid] = sources.fetch_fred(sid, HISTORY_START)
        except Exception as exc:  # noqa: BLE001
            log.append(f"FRED {sid}: no data ({exc})")
    try:
        stable = sources.fetch_stablecoin_supply()
    except Exception as exc:  # noqa: BLE001
        stable = None
        log.append(f"Stablecoins: no data ({exc})")
    return prices, vix, macro, stable


def _series_points(s, digits=2):
    s = s.dropna()
    return [[d.strftime("%Y-%m-%d"), round(float(v), digits)] for d, v in s.items()]


def build(prices, vix, macro, stable, demo=False, log=None):
    log = log or []
    if BENCHMARK not in prices:
        raise RuntimeError(f"benchmark {BENCHMARK} is missing; refusing to build")
    calendar = prices[BENCHMARK].index
    panel = an.align_to_calendar(prices, calendar)
    # Every flow figure below is measured against each market's own trailing normal.
    panel["flow"] = an.abnormal_flow(panel["flow"])
    tickers = [a.ticker for a in ASSETS if a.ticker in prices]
    close = panel["close"][tickers]
    vix_s = vix.reindex(calendar).ffill() if vix is not None else None

    # Cash buckets in USD billions.
    macro_bn = {sid: s * FRED_SERIES[sid]["unit_scale"] for sid, s in macro.items()}
    netliq = an.net_liquidity(macro_bn.get("WALCL"), macro_bn.get("WTREGEN"), macro_bn.get("RRPONTSYD"))
    cash_series = {
        "stablecoins": stable,
        "rrp": macro_bn.get("RRPONTSYD"),
        "tga": macro_bn.get("WTREGEN"),
        "net_liquidity": netliq,
        "retail_mmf": macro_bn.get("RMFSL"),
    }

    # Current rotation.
    windows = {}
    for w in FLOW_WINDOWS:
        wf = an.window_flows({k: v[tickers] for k, v in panel.items()}, w)
        net = {t: r["net_flow_bn"] for t, r in wf["assets"].items()}
        wf["sankey"] = an.allocate_flows(net)
        wf["wheel"] = an.class_flows(net, {a.ticker: a.group for a in ASSETS}, GROUPS, CASH_GROUP)
        windows[str(w)] = wf

    # Risk regime.
    score, parts = an.risk_appetite(close, vix_s)
    score = score.dropna()
    latest_score = float(score.iloc[-1]) if len(score) else float("nan")
    regime = {
        "score": an._num(latest_score, 3),
        "label": an.regime_label(latest_score),
        "components": {k: an._num(v, 3) for k, v in parts.iloc[-1].items()},
        "history": _series_points(score, 3),
    }

    # Relative performance over the last year, indexed to 100.
    perf = close.iloc[-253:]
    perf = perf / perf.bfill().iloc[0] * 100
    performance = {
        "dates": [d.strftime("%Y-%m-%d") for d in perf.index],
        "series": {t: [None if pd.isna(v) else round(float(v), 2) for v in perf[t]] for t in tickers},
    }

    corr_tickers = [t for t in ["BTC-USD", "GLD", "TLT", "UUP", "HYG"] if t in tickers]
    # Rolling correlation: weekly samples for the whole history, daily for the last three years.
    corr_all = an.rolling_correlation(close, BENCHMARK, corr_tickers).dropna(how="all")

    def corr_block(frame):
        return {
            "dates": [d.strftime("%Y-%m-%d") for d in frame.index],
            "series": {t: [None if pd.isna(v) else round(float(v), 3) for v in frame[t]] for t in corr_tickers},
        }

    correlations = {**corr_block(corr_all.iloc[::5]), "daily": corr_block(corr_all.iloc[-756:])}

    # Selloff history, with a wheel for each selloff so it can be replayed.
    asset_group = {a.ticker: a.group for a in ASSETS}
    episodes = an.find_selloffs(close[BENCHMARK], SELLOFF_THRESHOLD)
    episodes = an.selloff_stats({k: v[tickers] for k, v in panel.items()}, episodes, REBOUND_DAYS, cash_series)
    baseline_start = panel["flow"][BENCHMARK].first_valid_index()
    for ep in episodes:
        # Selloffs before each market has a year-long baseline can't be replayed.
        ep["wheel"] = None if pd.Timestamp(ep["peak"]) < baseline_start else an.class_flows(
            {t: a["net_flow_bn"] for t, a in ep["assets"].items()}, asset_group, GROUPS, CASH_GROUP)

    # Flow history between classes: weekly for three years, monthly since the start.
    flow = panel["flow"][tickers]
    history = {
        # 160 weeks, so weekly history covers the full three years of daily rows.
        "weekly": an.periodic_class_flows(flow, asset_group, GROUPS, CASH_GROUP, "W-FRI", periods=160),
        "monthly": an.periodic_class_flows(flow[flow.index >= "2017-01-01"], asset_group, GROUPS, CASH_GROUP, "ME"),
    }
    weekly_assets = (flow.resample("W-FRI").sum() / 1e9).iloc[-26:]

    # Market close-up: weekly net flow and closing price for every market, three years.
    wk_flow = (flow.resample("W-FRI").sum() / 1e9).iloc[-160:]
    wk_close = close.resample("W-FRI").last().reindex(wk_flow.index)
    wk_end = flow.index.to_series().resample("W-FRI").max().reindex(wk_flow.index)
    markets_weekly = {
        "end": [d.strftime("%Y-%m-%d") for d in wk_end],
        "net": {t: [an._num(v, 3) for v in wk_flow[t]] for t in tickers},
        "close": {t: [an._num(v, 4) for v in wk_close[t]] for t in tickers},
    }
    weekly_classes = pd.DataFrame(history["weekly"]["net"])
    streaks = {
        "classes": an.flow_streaks(weekly_classes),
        "assets": an.flow_streaks(weekly_assets),
    }

    cash_out = {}
    for key, s in cash_series.items():
        if s is None or s.empty:
            continue
        s = s[s.index >= "2016-01-01"]
        if key in ("stablecoins", "rrp"):
            s = s.resample("W-FRI").last()
        cash_out[key] = _series_points(s, 1)

    def last_change(s, periods_back):
        if s is None or len(s) <= periods_back:
            return None, None
        return an._num(s.iloc[-1], 2), an._num(s.iloc[-1] - s.iloc[-1 - periods_back], 2)

    stable_now, stable_chg = last_change(stable, 30) if stable is not None else (None, None)
    nl_now, nl_chg = last_change(netliq, 4)
    mmf = macro_bn.get("RMFSL")
    mmf_now, mmf_chg = last_change(mmf, 3)
    kpis = {
        "spy_20d": windows["20"]["assets"][BENCHMARK]["ret"],
        "btc_20d": windows["20"]["assets"].get("BTC-USD", {}).get("ret"),
        "vix": an._num(vix_s.dropna().iloc[-1], 2) if vix_s is not None else None,
        "stablecoins_bn": stable_now,
        "stablecoins_30d_bn": stable_chg,
        "net_liquidity_bn": nl_now,
        "net_liquidity_4w_bn": nl_chg,
        "retail_mmf_bn": mmf_now,
        "retail_mmf_3m_bn": mmf_chg,
        "drawdown": an._num(close[BENCHMARK].iloc[-1] / close[BENCHMARK].iloc[-253:].max() - 1),
    }

    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "as_of": calendar[-1].strftime("%Y-%m-%d"),
            "demo": demo,
            "sources": SOURCES,
            "warnings": log,
            "benchmark": BENCHMARK,
        },
        "groups": GROUPS,
        "assets": [{"ticker": a.ticker, "name": a.name, "short": a.short or a.name, "group": a.group}
                   for a in ASSETS if a.ticker in prices],
        "kpis": kpis,
        "regime": regime,
        "windows": windows,
        "performance": performance,
        "correlations": correlations,
        "cash": cash_out,
        "history": history,
        "markets_weekly": markets_weekly,
        "series": an.range_series(flow, panel["dollar_volume"][tickers], close),
        "streaks": streaks,
        "selloffs": {
            "threshold": SELLOFF_THRESHOLD,
            "rebound_days": REBOUND_DAYS,
            "episodes": episodes,
            "playbook": an.playbook(episodes, tickers),
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--demo", action="store_true", help="use synthetic data (no network)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    log = []
    if args.demo:
        from .demo import generate

        prices, vix, macro, stable = generate()
    else:
        prices, vix, macro, stable = collect_live(log)
        missing = len(ASSETS) - len(prices)
        if missing > len(ASSETS) // 3:
            print(f"Too many assets missing ({missing}); keeping the previous dashboard.json", file=sys.stderr)
            print("\n".join(log), file=sys.stderr)
            return 1

    data = build(prices, vix, macro, stable, demo=args.demo, log=log)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"Wrote {args.out} (as of {data['meta']['as_of']}, {len(data['selloffs']['episodes'])} selloffs)")
    for line in log:
        print("warning:", line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
