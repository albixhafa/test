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


def test_align_rolls_weekend_dollar_volume_into_next_trading_day():
    calendar = pd.DatetimeIndex(["2024-01-05", "2024-01-08"])  # Fri, Mon
    crypto_days = pd.date_range("2024-01-05", "2024-01-08", freq="D")
    crypto = ohlcv([100, 101, 102, 103], index=crypto_days, volume=1_000)
    panel = an.align_to_calendar({"BTC": crypto}, calendar)
    assert panel["close"]["BTC"].tolist() == [100, 103]
    # Sat + Sun + Mon dollar volume all lands on Monday.
    assert panel["dollar_volume"]["BTC"].iloc[1] == pytest.approx(1_000 * (101 + 102 + 103))


def test_fund_flows_are_new_shares_times_nav_and_skip_splits():
    days = pd.bdate_range("2024-01-01", periods=5)
    nav = pd.DataFrame({"nav": [100.0, 101, 102, 51, 51], "shares": [1e6, 1.1e6, 1.05e6, 2.1e6, 2.1e6]}, index=days)
    flow = an.fund_flows(nav)
    assert np.isnan(flow.iloc[0])
    assert flow.iloc[1] == pytest.approx(0.1e6 * 101)  # creation
    assert flow.iloc[2] == pytest.approx(-0.05e6 * 102)  # redemption
    assert flow.iloc[3] == 0  # 2-for-1 split, not money
    assert flow.iloc[4] == 0


def test_align_flows_rolls_weekends_and_keeps_pre_launch_days_empty():
    calendar = pd.bdate_range("2024-01-04", "2024-01-09")  # Thu .. Tue
    supply = pd.Series([10.0, 11.0, 12.0, 12.5, 13.0], index=pd.date_range("2024-01-05", periods=5))  # Fri .. Tue
    out = an.align_flows({"STABLES": an.supply_flows(supply)}, {"STABLES": supply * 1e9}, calendar)
    f = out["flow"]["STABLES"]
    assert np.isnan(f.iloc[0]) and np.isnan(f.iloc[1])  # before data and the first (diff-less) day
    assert f.loc["2024-01-08"] == pytest.approx(2.5e9)  # Sat + Sun + Mon
    assert f.loc["2024-01-09"] == pytest.approx(0.5e9)
    assert out["aum"]["STABLES"].loc["2024-01-09"] == pytest.approx(13e9)


def test_allocate_flows_conserves_and_routes_excess_to_sidelines():
    result = an.allocate_flows({"SPY": -30.0, "QQQ": -10.0, "GLD": 15.0, "TLT": 5.0, "BIL": None})
    links = result["links"]
    out_by_source = {}
    for l in links:
        out_by_source[l["source"]] = out_by_source.get(l["source"], 0) + l["value"]
    assert out_by_source["SPY"] == pytest.approx(30.0)
    assert out_by_source["QQQ"] == pytest.approx(10.0)
    into_gld = sum(l["value"] for l in links if l["target"] == "GLD")
    assert into_gld == pytest.approx(15.0)
    into_cash = sum(l["value"] for l in links if l["target"] == an.BALANCE_NODE)
    assert into_cash == pytest.approx(20.0)
    assert not any(l["source"] == an.BALANCE_NODE for l in links)


def test_allocate_flows_draws_from_sidelines_when_inflows_dominate():
    links = an.allocate_flows({"SPY": -5.0, "BTC-USD": 20.0})["links"]
    from_cash = sum(l["value"] for l in links if l["source"] == an.BALANCE_NODE)
    assert from_cash == pytest.approx(15.0)


def test_class_flows_nets_within_class_and_balances_through_sidelines():
    groups = ["Stocks", "Bonds", "Cash", "Crypto", "Sidelines"]
    asset_group = {"SPY": "Stocks", "XLU": "Stocks", "TLT": "Bonds", "BIL": "Cash", "BTC": "Crypto"}
    net = {"SPY": -50.0, "XLU": 10.0, "TLT": 15.0, "BIL": 3.0, "BTC": 5.0}
    wheel = an.class_flows(net, asset_group, groups, "Sidelines")
    assert wheel["net"] == {"Stocks": -40.0, "Bonds": 15.0, "Cash": 3.0, "Crypto": 5.0, "Sidelines": 17.0}
    assert wheel["total_bn"] == pytest.approx(40.0)
    into = {g: sum(l["value"] for l in wheel["links"] if l["target"] == g) for g in groups}
    assert into["Sidelines"] == pytest.approx(17.0)
    assert all(l["source"] == "Stocks" for l in wheel["links"])


def test_class_flows_draws_from_sidelines_when_markets_net_buy():
    wheel = an.class_flows({"SPY": 30.0, "TLT": -10.0, "QQQ": None}, {"SPY": "Stocks", "TLT": "Bonds", "QQQ": "Stocks"},
                           ["Stocks", "Bonds", "Sidelines"], "Sidelines")
    assert wheel["net"]["Sidelines"] == pytest.approx(-20.0)
    from_sidelines = sum(l["value"] for l in wheel["links"] if l["source"] == "Sidelines")
    assert from_sidelines == pytest.approx(20.0)


def test_periodic_class_flows_labels_partial_periods_by_last_trading_day():
    days = pd.bdate_range("2024-01-01", "2024-01-10")  # Mon 1st .. Wed 10th
    flow = pd.DataFrame({"SPY": -1e9, "TLT": 0.5e9}, index=days)
    out = an.periodic_class_flows(flow, {"SPY": "Stocks", "TLT": "Bonds"}, ["Stocks", "Bonds", "Sidelines"], "Sidelines", "W-FRI")
    assert out["start"] == ["2024-01-01", "2024-01-08"]
    assert out["end"] == ["2024-01-05", "2024-01-10"]
    assert out["net"]["Stocks"] == [-5.0, -3.0]
    assert out["net"]["Sidelines"] == [2.5, 1.5]
    assert out["total"] == [5.0, 3.0]
    # Stocks (0) -> Bonds (1) and Stocks -> Sidelines (2), as index triples.
    assert sorted(l[:2] for l in out["links"][0]) == [[0, 1], [0, 2]]


def test_flow_streaks_counts_inflow_weeks_and_acceleration():
    weekly = pd.DataFrame({"Gold": [1, 1, -1, 1, 2, 2, 2, 2.0], "Stocks": [-1.0] * 8})
    out = an.flow_streaks(weekly, lookback=8)
    assert out["Gold"]["inflow_weeks"] == 7
    assert out["Gold"]["recent_bn"] == 8.0 and out["Gold"]["prior_bn"] == 2.0
    assert out["Stocks"]["inflow_weeks"] == 0


def test_range_series_daily_and_monthly_rows():
    days = pd.bdate_range("2024-01-01", "2024-03-29")
    flow = pd.DataFrame({"SPY": 1e9}, index=days)
    aum = pd.DataFrame({"SPY": np.arange(len(days)) * 1e9 + 100e9}, index=days)
    close = pd.DataFrame({"SPY": range(len(days)), "QQQ": 1.0}, index=days, dtype="float64")
    out = an.range_series(flow, aum, close, daily_days=5, monthly_from="2024-01-01")
    assert out["daily"]["dates"][-1] == "2024-03-29" and len(out["daily"]["dates"]) == 5
    assert out["daily"]["flow"]["SPY"] == [1.0] * 5
    assert set(out["daily"]["close"]) == {"SPY", "QQQ"} and set(out["daily"]["flow"]) == {"SPY"}
    m = out["monthly"]
    assert m["start"] == ["2024-01-01", "2024-02-01", "2024-03-01"]
    assert m["end"] == ["2024-01-31", "2024-02-29", "2024-03-29"]
    assert m["flow"]["SPY"] == [23.0, 21.0, 21.0]  # trading days per month, $1B each
    assert m["aum"]["SPY"] == [100.0, 123.0, 144.0]  # size on each month's first day
    assert m["close"]["SPY"][-1] == float(len(days) - 1)


def test_positioning_summary_percentile_and_change():
    days = pd.date_range("2023-01-03", periods=10, freq="W-TUE")
    frame = pd.DataFrame({"spec_net": [float(x) for x in range(10)], "open_interest": 100.0, "am_net": -1.0}, index=days)
    out = an.positioning_summary(frame)
    assert out["latest"] == 9 and out["change_1w"] == 1
    assert out["percentile"] == pytest.approx(95.0)  # highest of ten readings
    assert out["pct_of_oi"] == pytest.approx(0.09)
    assert out["am_net"][-1] == -1


def test_pack_columns_rounds_and_nulls():
    df = pd.DataFrame({"a": [1.23456789, float("nan")]})
    assert an.pack_columns(df, 3) == {"a": [1.23, None]}


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


def test_volume_to_units_gives_usd_dollar_volume():
    df = ohlcv([50_000.0, 60_000.0], volume=[3e10, 4e10])
    converted = sources.volume_to_units(df)
    assert (converted["close"] * converted["volume"]).tolist() == pytest.approx([3e10, 4e10])


def test_parse_fred_csv_handles_missing_values():
    s = sources.parse_fred_csv("observation_date,RRPONTSYD\n2024-01-02,500.1\n2024-01-03,.\n")
    assert s.tolist() == [500.1]


def test_parse_defillama():
    s = sources.parse_defillama_stablecoins([
        {"date": "1704067200", "totalCirculatingUSD": {"peggedUSD": 1.3e11}},
    ])
    assert s.iloc[0] == pytest.approx(130.0)


def test_parse_ssga_nav_history_reads_only_the_table(tmp_path):
    import io

    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    for row in [("Fund Name:", "Test ETF"), ("Ticker Symbol:", "TST"), (None,),
                ("Date", "NAV", "Shares Outstanding", "Total Net Assets"),
                ("29-Oct-2026", 10.5, 1200.0, 12600.0), ("28-Oct-2026", 10.0, 1000.0, 10000.0),
                ("Distributor: some disclaimer",)]:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    df = sources.parse_ssga_nav_history(buf.getvalue())
    assert list(df.index.strftime("%Y-%m-%d")) == ["2026-10-28", "2026-10-29"]
    assert df["shares"].tolist() == [1000.0, 1200.0]
    assert an.fund_flows(df).iloc[-1] == pytest.approx(200 * 10.5)


def test_parse_cftc_nets_long_minus_short():
    rows = [{"report_date_as_yyyy_mm_dd": "2026-10-20T00:00:00.000", "open_interest_all": "100",
             "lev_money_positions_long": "30", "lev_money_positions_short": "50",
             "asset_mgr_positions_long": "60", "asset_mgr_positions_short": "10"}]
    df = sources.parse_cftc(rows, "tff")
    assert df["spec_net"].iloc[0] == -20 and df["am_net"].iloc[0] == 50
    assert df.index[0] == pd.Timestamp("2026-10-20")


def test_demo_build_produces_complete_dashboard():
    data = build(**generate(end="2026-01-30"), demo=True)
    assert data["meta"]["demo"] is True
    assert set(data["windows"]) == {"5", "20", "60"}
    assert data["selloffs"]["episodes"]
    assert data["selloffs"]["playbook"]
    assert data["regime"]["label"] in {"Risk-on", "Risk-off", "Neutral"}
    for key in ("stablecoins", "rrp", "net_liquidity", "retail_mmf"):
        assert data["cash"][key]
    assert len(data["positioning"]) == 8 and set(data["rates"]) >= {"DGS10", "NFCI"}
    flows = {a["ticker"] for a in data["assets"] if a["flows"]}
    assert {"SPY", "GLD", "BIL", "STABLES"} <= flows and "QQQ" not in flows
    # Every class nets to zero once the sidelines are counted.
    for w in data["windows"].values():
        assert sum(w["wheel"]["net"].values()) == pytest.approx(0, abs=1e-3)
