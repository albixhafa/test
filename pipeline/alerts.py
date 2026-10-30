"""Compare yesterday's and today's dashboard.json and describe anything worth an alert.

    python -m pipeline.alerts previous.json current.json

Prints a GitHub issue title on the first line and a Markdown body after it, or nothing
when there is nothing new. Every alert is a state change between the two files, so each
one fires once rather than every day the condition holds.
"""

import json
import os
import sys

SITE = os.environ.get("SITE_URL", "https://albixhafa.github.io/test/")
EXTREME_Z = 2.0
BIG_WEEK_QUANTILE = 0.95


def _pct(x):
    return f"{x * 100:+.1f}%"


def _bn(x):
    return f"${x / 1000:.2f}T" if abs(x) >= 999.5 else f"${x:,.0f}B"


def detect_events(prev, cur):
    events = []

    # Mood change.
    before, after = prev.get("regime", {}).get("label"), cur["regime"]["label"]
    if before and after != before:
        events.append(("mood", f"Market mood changed from {before} to {after}",
                       f"The risk appetite score is now {cur['regime']['score']:+.2f}."))

    # Selloff started or ended.
    def ongoing(d):
        eps = d.get("selloffs", {}).get("episodes", [])
        return eps[-1] if eps and eps[-1].get("ongoing") else None

    was, now = ongoing(prev), ongoing(cur)
    if now and (not was or was["peak"] != now["peak"]):
        events.append(("selloff", "A new S&P 500 selloff has started",
                       f"The S&P 500 is {_pct(now['drawdown'])} from its {now['peak']} high."))
    if was and not now:
        eps = cur["selloffs"]["episodes"]
        done = next((e for e in reversed(eps) if e["peak"] == was["peak"]), None)
        detail = f"It bottomed on {done['trough']} at {_pct(done['drawdown'])}." if done else ""
        events.append(("selloff-end", "The S&P 500 selloff is over", f"It has rebounded enough to count as finished. {detail}"))

    # A newly completed week with unusually heavy flows between classes.
    pw, cw = prev.get("history", {}).get("weekly"), cur.get("history", {}).get("weekly")
    if pw and cw and len(cw["end"]) >= 2 and cw["end"][-1] != pw["end"][-1]:
        totals = sorted(cw["total"][:-1])
        threshold = totals[int(BIG_WEEK_QUANTILE * (len(totals) - 1))]
        week = cw["total"][-2]
        if week >= threshold:
            nets = {g: v[-2] for g, v in cw["net"].items()}
            out = min(nets, key=nets.get)
            into = max(nets, key=nets.get)
            events.append(("big-week", f"Unusually large week of flows ({_bn(week)} moved)",
                           f"In the week of {cw['start'][-2]}, {_bn(-nets[out])} left {out} and {_bn(nets[into])} went into {into}. "
                           f"That is among the heaviest 5% of weeks in three years."))

    # A warning signal newly crossing into extreme territory.
    pc, cc = prev.get("regime", {}).get("components", {}), cur["regime"]["components"]
    for name, z in cc.items():
        if z is None:
            continue
        old = pc.get(name)
        if abs(z) >= EXTREME_Z and (old is None or abs(old) < EXTREME_Z):
            events.append(("signal", f"Extreme reading: {name} ({z:+.1f})",
                           f"{name} is {abs(z):.1f} standard deviations {'above' if z > 0 else 'below'} its past-year norm."))
    return events


def render(events, cur):
    if not events:
        return ""
    title = f"Liquidity alert {cur['meta']['as_of']}: " + "; ".join(e[1] for e in events[:2])
    if len(events) > 2:
        title += f" (+{len(events) - 2} more)"
    lines = [f"Data through **{cur['meta']['as_of']}**.", ""]
    for _, headline, detail in events:
        lines += [f"- **{headline}.** {detail}"]
    lines += ["", f"See the dashboard: {SITE}", "", "_Automated alert from the daily refresh. Not investment advice._"]
    return title + "\n" + "\n".join(lines)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    try:
        prev = json.load(open(argv[0]))
    except (OSError, ValueError):
        return 0  # no previous data to compare with
    cur = json.load(open(argv[1]))
    if prev.get("meta", {}).get("demo") or cur["meta"].get("demo"):
        return 0
    out = render(detect_events(prev, cur), cur)
    if out:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
