import numpy as np
import pandas as pd
import pytest

from pipeline import analytics as an
from pipeline import sources
from pipeline.build import build
from pipeline.demo import generate


def ohlcv(closes, highs=None, lows=None, volume=1_000, index=None):
    closes = np.asarray(closes, dtype=float)
    index = index if index is not None else pd.bdate_range("2024-01-01", periods=len(closes))
    return pd.DataFrame({
        "open": closes,
        "high": highs if highs is not None else closes + 1,
        "low": lows if lows is not None else closes - 1,
        "close": closes,
        "volume": volume,
        "adj_close": closes,
    }, index=index)


def test_money_flow_signs_by_close_location():
    df = ohlcv([10, 10, 10], highs=[11, 11, 10], lows=[9, 10, 10], volume=100)
    df.loc[df.index[0], "close"] = 11  # closes at the high -> full buying pressure
    df.loc[df.index[1], "close"] = 10  # closes at the low -> full selling pressure
    flow = an.money_flow(df)
    assert flow.iloc[0] == pytest.approx(11 * 100)
    assert flow.iloc[1] == pytest.approx(-10 * 100)
    assert flow.iloc[2] == 0  # zero range day contributes nothing


def test_align_rolls_weekend_flow_into_next_trading_day():
    calendar = pd.DatetimeIndex(["2024-01-05", "2024-01-08"])  # Fri, Mon
    crypto_days = pd.date_range("2024-01-05", "2024-01-08", freq="D")
    crypto = ohlcv([100, 101, 102, 103], index=crypto_days)
    crypto["close"] = crypto["high"]  # every day is pure buying
    panel = an.align_to_calendar({"BTC": crypto}, calendar)
    assert panel["close"]["BTC"].tolist() == [100, 103]
    # Sat + Sun + Mon flows all land on Monday.
    assert panel["flow"]["BTC"].iloc[1] == pytest.approx(1_000 * (102 + 103 + 104))


def test_allocate_flows_conserves_and_routes_excess_to_cash():
    result = an.allocate_flows({"SPY": -30.0, "QQQ": -10.0, "GLD": 15.0, "TLT": 5.0, "BIL": None})
    links = result["links"]
    out_by_source = {}
    for l in links:
        out_by_source[l["source"]] = out_by_source.get(l["source"], 0) + l["value"]
    assert out_by_source["SPY"] == pytest.approx(30.0)
    assert out_by_source["QQQ"] == pytest.approx(10.0)
    into_gld = sum(l["value"] for l in links if l["target"] == "GLD")
    assert into_gld == pytest.approx(15.0)
    into_cash = sum(l["value"] for l in links if l["target"] == an.CASH_NODE)
    assert into_cash == pytest.approx(20.0)
    assert not any(l["source"] == an.CASH_NODE for l in links)


def test_allocate_flows_draws_from_cash_when_inflows_dominate():
    links = an.allocate_flows({"SPY": -5.0, "BTC-USD": 20.0})["links"]
    from_cash = sum(l["value"] for l in links if l["source"] == an.CASH_NODE)
    assert from_cash == pytest.approx(15.0)


def test_find_selloffs_zigzag():
    prices = [100, 105, 110, 100, 95, 99, 104, 103, 112, 120, 108, 104]
    s = pd.Series(prices, index=pd.bdate_range("2024-01-01", periods=len(prices)))
    eps = an.find_selloffs(s, 0.07)
    assert [(e["peak"], e["trough"], e["ongoing"]) for e in eps] == [
        (s.index[2].strftime("%Y-%m-%d"), s.index[4].strftime("%Y-%m-%d"), False),
        (s.index[9].strftime("%Y-%m-%d"), s.index[11].strftime("%Y-%m-%d"), True),
    ]
    assert eps[0]["drawdown"] == pytest.approx(95 / 110 - 1, abs=1e-6)


def test_find_selloffs_ignores_shallow_dips():
    s = pd.Series([100, 97, 101, 96, 102], index=pd.bdate_range("2024-01-01", periods=5))
    assert an.find_selloffs(s, 0.07) == []


def test_net_liquidity_aligns_weekly():
    weekly = pd.date_range("2024-01-03", periods=3, freq="W-WED")
    fed = pd.Series([7000.0, 7010.0, 7020.0], index=weekly)
    tga = pd.Series([700.0, 720.0, 710.0], index=weekly)
    rrp = pd.Series([500.0, 480.0, 470.0, 460.0], index=pd.bdate_range("2024-01-02", periods=4))
    nl = an.net_liquidity(fed, tga, rrp)
    assert nl.iloc[0] == pytest.approx(7000 - 700 - 480)


def test_parse_yahoo_chart():
    payload = {"chart": {"result": [{
        "timestamp": [1704205800, 1704292200],
        "indicators": {
            "quote": [{"open": [1, 2], "high": [2, 3], "low": [0.5, 1.5], "close": [1.5, None], "volume": [10, 20]}],
            "adjclose": [{"adjclose": [1.4, None]}],
        },
    }]}}
    df = sources.parse_yahoo_chart(payload)
    assert len(df) == 1
    assert df["adj_close"].iloc[0] == 1.4


def test_parse_fred_csv_handles_missing_values():
    s = sources.parse_fred_csv("observation_date,RRPONTSYD\n2024-01-02,500.1\n2024-01-03,.\n")
    assert s.tolist() == [500.1]


def test_parse_defillama():
    s = sources.parse_defillama_stablecoins([
        {"date": "1704067200", "totalCirculatingUSD": {"peggedUSD": 1.3e11}},
    ])
    assert s.iloc[0] == pytest.approx(130.0)


def test_demo_build_produces_complete_dashboard():
    prices, vix, macro, stable = generate(end="2026-01-30")
    data = build(prices, vix, macro, stable, demo=True)
    assert data["meta"]["demo"] is True
    assert set(data["windows"]) == {"5", "20", "60"}
    assert data["selloffs"]["episodes"]
    assert data["selloffs"]["playbook"]
    assert data["regime"]["label"] in {"Risk-on", "Risk-off", "Neutral"}
    for key in ("stablecoins", "rrp", "net_liquidity", "retail_mmf"):
        assert data["cash"][key]
