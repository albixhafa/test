"""Build docs/data/dashboard.json.

    python -m pipeline.build          # live data from Yahoo, Stooq, State Street, CFTC, FRED and DefiLlama
    python -m pipeline.build --demo   # synthetic data, no network
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import analytics as an
from .config import (ASSETS, BALANCE_GROUP, BENCHMARK, FLOW_WINDOWS, FRED_SERIES, GROUPS,
                     HISTORY_START, POSITIONING, RATES_SERIES, REBOUND_DAYS, SELLOFF_THRESHOLD, VIX)

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "dashboard.json"

SOURCES = [
    {"name": "State Street", "detail": "Daily shares outstanding and NAV for SPDR funds (real fund flows)"},
    {"name": "Yahoo Finance", "detail": "Daily prices and volume for ETFs and crypto (Stooq as fallback)"},
    {"name": "CFTC", "detail": "Weekly Commitments of Traders: futures positioning"},
    {"name": "FRED", "detail": "Fed balance sheet, TGA, reverse repo, money funds, CPI, yields, credit spreads"},
    {"name": "DefiLlama", "detail": "Total USD stablecoin supply"},
]


def collect_live(log):
    from . import sources

    prices = {}
    for asset in ASSETS:
        if asset.flows == "stablecoins":
            continue
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

    funds = {}
    for asset in ASSETS:
        if asset.flows != "ssga":
            continue
        try:
            funds[asset.ticker] = sources.fetch_ssga(asset.ticker.lower())
        except Exception as exc:  # noqa: BLE001
            log.append(f"{asset.ticker}: no fund flow data ({exc})")

    macro = {}
    for sid in [*FRED_SERIES, *RATES_SERIES]:
        try:
            macro[sid] = sources.fetch_fred(sid, HISTORY_START)
        except Exception as exc:  # noqa: BLE001
            log.append(f"FRED {sid}: no data ({exc})")
    try:
        macro["MMF_TOTAL"] = sources.fetch_mmf_assets()
    except Exception as exc:  # noqa: BLE001
        log.append(f"OFR money market funds: no data ({exc})")
    try:
        stable = sources.fetch_stablecoin_supply()
    except Exception as exc:  # noqa: BLE001
        stable = None
        log.append(f"Stablecoins: no data ({exc})")

    cftc = {}
    for p in POSITIONING:
        try:
            cftc[p["key"]] = sources.fetch_cftc(p["report"], p["code"], HISTORY_START)
        except Exception as exc:  # noqa: BLE001
            log.append(f"CFTC {p['name']}: no data ({exc})")
    return {"prices": prices, "vix": vix, "macro": macro, "stable": stable, "funds": funds, "cftc": cftc}


def _series_points(s, digits=2):
    s = s.dropna()
    return [[d.strftime("%Y-%m-%d"), round(float(v), digits)] for d, v in s.items()]


def _weekly_points(s, digits):
    """Last observation of each week, dated by that observation."""
    s = s.dropna()
    return _series_points(s.groupby(pd.Grouper(freq="W-FRI")).tail(1), digits)


def build(prices, vix, macro, stable, funds=None, cftc=None, demo=False, log=None):
    log = log or []
    funds, cftc = funds or {}, cftc or {}
    if BENCHMARK not in prices:
        raise RuntimeError(f"benchmark {BENCHMARK} is missing; refusing to build")
    calendar = prices[BENCHMARK].index
    panel = an.align_to_calendar(prices, calendar)
    # Stablecoins have no price; their "close" is the total supply.
    if stable is not None:
        panel["close"]["STABLES"] = stable.reindex(calendar.union(stable.index)).ffill().reindex(calendar)
        panel["dollar_volume"]["STABLES"] = 0.0

    # Real flows: creations minus redemptions for each fund, stablecoin issuance for crypto.
    flows, sizes = {}, {}
    for a in ASSETS:
        if a.flows == "ssga" and a.ticker in funds:
            flows[a.ticker], sizes[a.ticker] = an.fund_flows(funds[a.ticker]), funds[a.ticker]["aum"]
        elif a.flows == "stablecoins" and stable is not None:
            flows[a.ticker], sizes[a.ticker] = an.supply_flows(stable), stable * 1e9
    panel.update(an.align_flows(flows, sizes, calendar))

    tickers = [a.ticker for a in ASSETS if a.ticker in panel["close"].columns]
    flow_tickers = [t for t in tickers if t in panel["flow"].columns]
    close = panel["close"][tickers]
    flow_panel = {"close": close, "dollar_volume": panel["dollar_volume"][tickers],
                  "flow": panel["flow"][flow_tickers], "aum": panel["aum"][flow_tickers]}
    vix_s = vix.reindex(calendar).ffill() if vix is not None else None

    # Cash buckets in USD billions.
    macro_bn = {sid: s * FRED_SERIES[sid]["unit_scale"] for sid, s in macro.items() if sid in FRED_SERIES}
    netliq = an.net_liquidity(macro_bn.get("WALCL"), macro_bn.get("WTREGEN"), macro_bn.get("RRPONTSYD"))
    cash_series = {
        "stablecoins": stable,
        "rrp": macro_bn.get("RRPONTSYD"),
        "tga": macro_bn.get("WTREGEN"),
        "net_liquidity": netliq,
        "retail_mmf": macro_bn.get("RMFSL"),
        "mmf_total": macro.get("MMF_TOTAL"),
    }

    # Current rotation.
    windows = {}
    for w in FLOW_WINDOWS:
        wf = an.window_flows(flow_panel, w)
        net = {t: r["net_flow_bn"] for t, r in wf["assets"].items()}
        wf["sankey"] = an.allocate_flows(net)
        wf["wheel"] = an.class_flows(net, {a.ticker: a.group for a in ASSETS}, GROUPS, BALANCE_GROUP)
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

    corr_tickers = [t for t in ["BTC-USD", "GLD", "SPTL", "UUP", "JNK"] if t in tickers]
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
    episodes = an.selloff_stats(flow_panel, episodes, REBOUND_DAYS, cash_series)
    for ep in episodes:
        nets = {t: a["net_flow_bn"] for t, a in ep["assets"].items() if a["net_flow_bn"] is not None}
        ep["wheel"] = an.class_flows(nets, asset_group, GROUPS, BALANCE_GROUP) if nets else None

    # Flow history between classes: weekly for three years, monthly since the start.
    flow = panel["flow"][flow_tickers]
    history = {
        # 160 weeks, so weekly history covers the full three years of daily rows.
        "weekly": an.periodic_class_flows(flow, asset_group, GROUPS, BALANCE_GROUP, "W-FRI", periods=160),
        "monthly": an.periodic_class_flows(flow[flow.index >= "2017-01-01"], asset_group, GROUPS, BALANCE_GROUP, "ME"),
    }
    weekly_assets = (flow.resample("W-FRI").sum(min_count=1) / 1e9).iloc[-26:]

    # Market close-up: weekly net flow (markets with flow data) and closing price, three years.
    wk_close = close.resample("W-FRI").last().iloc[-160:]
    wk_flow = (flow.resample("W-FRI").sum(min_count=1) / 1e9).reindex(wk_close.index)
    wk_end = close.index.to_series().resample("W-FRI").max().reindex(wk_close.index)
    markets_weekly = {
        "end": [d.strftime("%Y-%m-%d") for d in wk_end],
        "net": {t: [an._num(v, 3) for v in wk_flow[t]] for t in flow_tickers},
        "close": {t: [an._num(v, 4) for v in wk_close[t]] for t in tickers},
    }
    weekly_classes = pd.DataFrame(history["weekly"]["net"]).drop(columns=[BALANCE_GROUP])
    streaks = {
        "classes": an.flow_streaks(weekly_classes),
        "assets": an.flow_streaks(weekly_assets),
    }

    cash_out = {}
    for key, s in cash_series.items():
        if s is None or s.empty:
            continue
        s = s[s.index >= "2016-01-01"]
        # Daily series as weekly samples dated by their last observation, so the newest
        # point never sits in the future.
        cash_out[key] = _weekly_points(s, 1) if key in ("stablecoins", "rrp") else _series_points(s, 1)

    def last_change(s, periods_back):
        if s is None or len(s) <= periods_back:
            return None, None
        return an._num(s.iloc[-1], 2), an._num(s.iloc[-1] - s.iloc[-1 - periods_back], 2)

    stable_now, stable_chg = last_change(stable, 30) if stable is not None else (None, None)
    nl_now, nl_chg = last_change(netliq, 4)
    mmf = macro_bn.get("RMFSL")
    mmf_now, mmf_chg = last_change(mmf, 3)
    # Money market funds: net new money each month, after stripping out interest.
    mmf_flow = an.mmf_flows(macro["MMF_TOTAL"], macro.get("DTB3")) if "MMF_TOTAL" in macro else None
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
        "mmf_total_bn": an._num(macro["MMF_TOTAL"].iloc[-1], 2) if "MMF_TOTAL" in macro else None,
        "drawdown": an._num(close[BENCHMARK].iloc[-1] / close[BENCHMARK].iloc[-253:].max() - 1),
    }

    # Futures positioning: speculators' net position and where it sits in three years.
    positioning = []
    for p in POSITIONING:
        if p["key"] in cftc:
            summary = an.positioning_summary(cftc[p["key"]])
            if summary:
                positioning.append({"key": p["key"], "name": p["name"],
                                    "who": "Leveraged funds" if p["report"] == "tff" else "Managed money", **summary})

    # Rates and credit backdrop, weekly samples since 2016.
    rates = {sid: {"name": cfg["name"], "unit": cfg["unit"], "points": _weekly_points(macro[sid][macro[sid].index >= "2016-01-01"], 3)}
             for sid, cfg in RATES_SERIES.items() if sid in macro and not macro[sid].empty}

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
        "balance_group": BALANCE_GROUP,
        "assets": [{"ticker": a.ticker, "name": a.name, "short": a.short or a.name, "group": a.group,
                    "flows": a.ticker in flow_tickers}
                   for a in ASSETS if a.ticker in tickers],
        "kpis": kpis,
        "regime": regime,
        "windows": windows,
        "performance": performance,
        "correlations": correlations,
        "cash": cash_out,
        "history": history,
        "markets_weekly": markets_weekly,
        # Monthly CPI (index level) for the page's inflation-adjusted view.
        "cpi": _series_points(macro["CPIAUCSL"][macro["CPIAUCSL"].index >= "2015-12-01"], 3) if "CPIAUCSL" in macro else None,
        "series": an.range_series(flow, panel["aum"][flow_tickers], close),
        "positioning": positioning,
        "rates": rates,
        "mmf_flows": _series_points(mmf_flow[mmf_flow.index >= "2016-01-01"], 1) if mmf_flow is not None else None,
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

        raw = generate()
    else:
        raw = collect_live(log)
        priced = [a for a in ASSETS if a.flows != "stablecoins"]
        with_flows = [a for a in ASSETS if a.flows == "ssga"]
        missing = len(priced) - len(raw["prices"])
        missing_flows = len(with_flows) - len(raw["funds"])
        if missing > len(priced) // 3 or missing_flows > len(with_flows) // 3:
            print(f"Too much data missing ({missing} prices, {missing_flows} fund flows); "
                  "keeping the previous dashboard.json", file=sys.stderr)
            print("\n".join(log), file=sys.stderr)
            return 1

    data = build(**raw, demo=args.demo, log=log)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"Wrote {args.out} (as of {data['meta']['as_of']}, {len(data['selloffs']['episodes'])} selloffs)")
    for line in log:
        print("warning:", line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
