import copy

from pipeline.alerts import detect_events, render


def base():
    return {
        "meta": {"as_of": "2026-10-29", "demo": False},
        "regime": {"label": "Neutral", "score": -0.2, "components": {"Credit vs Treasuries": -1.9}},
        "selloffs": {"episodes": [{"peak": "2026-01-27", "trough": "2026-03-30", "drawdown": -0.09, "ongoing": False}]},
        "history": {"weekly": {
            "start": ["2026-10-12", "2026-10-19", "2026-10-26"],
            "end": ["2026-10-16", "2026-10-23", "2026-10-29"],
            "total": [100.0, 120.0, 50.0],
            "net": {"Stocks": [-50.0, -60.0, 5.0], "Cash": [50.0, 60.0, -5.0]},
        }},
    }


def test_no_events_when_nothing_changes():
    assert detect_events(base(), base()) == []
    assert render([], base()) == ""


def test_mood_change_and_extreme_signal():
    cur = base()
    cur["regime"].update(label="Risk-off", score=-0.8, components={"Credit vs Treasuries": -2.3})
    kinds = [e[0] for e in detect_events(base(), cur)]
    assert kinds == ["mood", "signal"]
    assert render(detect_events(base(), cur), cur).startswith("Liquidity alert 2026-10-29: Market mood changed")


def test_new_selloff_fires_once():
    cur = base()
    cur["selloffs"]["episodes"].append({"peak": "2026-10-01", "trough": "2026-10-29", "drawdown": -0.08, "ongoing": True})
    assert [e[0] for e in detect_events(base(), cur)] == ["selloff"]
    assert detect_events(cur, copy.deepcopy(cur)) == []


def test_big_week_only_on_week_rollover():
    prev = base()
    cur = copy.deepcopy(prev)
    w = cur["history"]["weekly"]
    w["start"].append("2026-11-02")
    w["end"].append("2026-11-02")
    w["total"][-1] = 400.0  # the week that just completed was huge
    w["total"].append(10.0)
    for k in w["net"]:
        w["net"][k][-1] = -400.0 if k == "Stocks" else 400.0
        w["net"][k].append(0.0)
    events = detect_events(prev, cur)
    assert [e[0] for e in events] == ["big-week"]
    assert "left Stocks" in events[0][2]
    assert detect_events(cur, copy.deepcopy(cur)) == []
