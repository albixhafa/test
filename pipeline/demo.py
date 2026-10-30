"""Synthetic market history so the dashboard renders without network access.

The numbers are invented. They follow plausible cross-asset behaviour (risk assets
fall together in selloffs, havens catch a bid, volume surges) so every panel can be
exercised, but they must never be read as market data. The build marks the output
with meta.demo = true and the page shows a banner.
"""

import numpy as np
import pandas as pd

# ticker: (market beta, idiosyncratic daily vol, haven bid in selloffs, $bn/day traded, start price)
PROFILE = {
    "SPY": (1.00, 0.002, 0.000, 30.0, 200),
    "QQQ": (1.20, 0.004, 0.000, 18.0, 110),
    "IWM": (1.15, 0.005, -0.001, 5.0, 115),
    "SPDW": (0.85, 0.004, 0.000, 0.3, 27),
    "SPEM": (0.95, 0.006, -0.001, 0.2, 33),
    "XLK": (1.20, 0.005, 0.000, 1.5, 42),
    "XLF": (1.10, 0.006, -0.001, 1.8, 23),
    "XLE": (0.90, 0.012, -0.001, 1.5, 60),
    "XLV": (0.70, 0.005, 0.0005, 1.0, 68),
    "XLI": (1.00, 0.005, 0.000, 1.0, 53),
    "XLY": (1.10, 0.006, -0.0005, 0.8, 76),
    "XLP": (0.55, 0.004, 0.0015, 0.8, 50),
    "XLU": (0.45, 0.006, 0.0012, 1.0, 45),
    "XLB": (0.95, 0.006, 0.000, 0.5, 45),
    "XLRE": (0.80, 0.007, 0.000, 0.3, 32),
    "XLC": (1.05, 0.006, 0.000, 0.4, 50),
    "BIL": (0.00, 0.0002, 0.0001, 0.6, 91),
    "UUP": (-0.12, 0.003, 0.0020, 0.08, 25),
    "SPTI": (-0.15, 0.003, 0.0015, 0.15, 30),
    "SPTL": (-0.30, 0.008, 0.0030, 0.2, 35),
    "SPBO": (0.10, 0.003, 0.0005, 0.05, 30),
    "JNK": (0.40, 0.002, -0.0010, 1.0, 100),
    "GLD": (-0.05, 0.009, 0.0035, 1.8, 105),
    "DBC": (0.40, 0.010, -0.0010, 0.15, 14),
    "BTC-USD": (1.60, 0.030, -0.0020, 30.0, 430),
    "ETH-USD": (2.00, 0.040, -0.0030, 15.0, 1),
}
# Extra volume in selloffs; havens see the heaviest turnover relative to normal.
SELLOFF_VOLUME = {"BIL": 2.2, "GLD": 1.9, "SPTL": 1.8, "SPTI": 1.6, "UUP": 1.7, "XLP": 1.4, "XLU": 1.4}
# ticker: (fund size in $bn at the start, daily flow noise as a share of size, selloff flow tilt)
FUNDS = {
    "SPY": (190, 0.006, -0.004), "SPDW": (5, 0.002, -0.001), "SPEM": (3, 0.002, -0.001),
    "XLK": (15, 0.003, -0.001), "XLF": (17, 0.004, -0.002), "XLE": (12, 0.004, -0.001),
    "XLV": (12, 0.003, 0.000), "XLI": (8, 0.003, -0.001), "XLY": (9, 0.003, -0.001),
    "XLP": (8, 0.003, 0.002), "XLU": (6, 0.004, 0.002), "XLB": (4, 0.003, -0.001),
    "XLRE": (2, 0.003, 0.000), "XLC": (1, 0.003, -0.001), "BIL": (3, 0.004, 0.006),
    "SPTI": (1, 0.003, 0.003), "SPTL": (0.5, 0.004, 0.004), "SPBO": (0.5, 0.003, 0.000),
    "JNK": (10, 0.004, -0.004), "GLD": (30, 0.002, 0.003),
}
FUND_START = {"XLC": "2018-06-19"}


def _market_factor(n, rng):
    drift = np.full(n, 0.0007)
    vol = np.full(n, 0.008)
    crash = np.zeros(n, dtype=bool)
    i = 120
    while i < n - 30:
        i += int(rng.integers(200, 420))
        length = int(rng.integers(10, 35))
        if i + length >= n:
            break
        severity = rng.uniform(0.003, 0.008)
        drift[i:i + length] = -severity
        vol[i:i + length] = 0.012 + severity * 1.5
        crash[i:i + length] = True
        # Relief rally afterwards.
        drift[i + length:i + length + 25] = 0.003
    return drift + vol * rng.standard_normal(n), crash


def _ohlcv(ret, dollar_volume, sigma, rng, start_price):
    close = start_price * np.exp(np.cumsum(ret))
    prev = np.concatenate([[start_price], close[:-1]])
    clv = np.clip(ret / (2 * sigma) + 0.35 * rng.standard_normal(len(ret)), -1, 1)
    span = close * (np.abs(ret) + sigma * rng.uniform(0.6, 1.4, len(ret)))
    low = close - (1 + clv) / 2 * span
    high = low + span
    return pd.DataFrame({
        "open": prev,
        "high": high,
        "low": low,
        "close": close,
        "volume": dollar_volume / close,
        "adj_close": close,
    })


def _smooth_path(index, knots, rng, noise=0.004):
    """Piecewise-linear path through (date, value) knots with multiplicative noise."""
    x = index.asi8
    kx = pd.to_datetime([k[0] for k in knots]).asi8
    base = np.interp(x, kx, [k[1] for k in knots])
    wiggle = np.exp(np.cumsum(noise * rng.standard_normal(len(index))) * 0.3)
    wiggle /= pd.Series(wiggle).rolling(30, min_periods=1).mean().to_numpy()
    return pd.Series(base * wiggle, index=index)


def generate(start="2016-01-01", end=None, seed=7):
    rng = np.random.default_rng(seed)
    end = pd.Timestamp(end or pd.Timestamp.today().normalize())
    days = pd.bdate_range(start, end)
    n = len(days)
    mkt, crash = _market_factor(n, rng)

    prices = {}
    for ticker, (beta, idio, haven, dv_bn, px0) in PROFILE.items():
        ret = beta * mkt + idio * rng.standard_normal(n) + 0.00008
        ret = ret + np.where(crash, haven, 0.0)
        if ticker == "BIL":
            ret = 0.00012 + idio * rng.standard_normal(n)
        surge = np.where(crash, SELLOFF_VOLUME.get(ticker, 1.5), 1.0)
        dv = dv_bn * 1e9 * surge * rng.lognormal(0, 0.25, n)
        dv *= np.linspace(0.6, 1.3, n)  # markets grow
        sigma = np.sqrt((beta * 0.009) ** 2 + idio ** 2) + 1e-4
        df = _ohlcv(ret, dv, sigma, rng, px0)
        df.index = days
        if ticker == "ETH-USD":
            df = df[df.index >= "2017-11-09"]
        prices[ticker] = df

    realised = pd.Series(mkt, index=days).rolling(10, min_periods=2).std().bfill()
    vix = (realised * np.sqrt(252) * 100 * 1.15 + 2 + rng.normal(0, 0.8, n)).clip(lower=9)

    weekly = pd.date_range(start, end, freq="W-WED")
    daily = pd.bdate_range(start, end)
    monthly = pd.date_range(start, end, freq="MS")
    macro = {
        "WALCL": _smooth_path(weekly, [(start, 4.45e6), ("2019-09-01", 3.8e6), ("2020-03-01", 4.3e6),
                                       ("2020-06-01", 7.1e6), ("2022-04-01", 8.95e6), ("2024-06-01", 7.2e6),
                                       (end, 6.55e6)], rng, 0.001),
        "WTREGEN": _smooth_path(weekly, [(start, 3.0e5), ("2020-07-01", 1.75e6), ("2021-10-01", 1.5e5),
                                         ("2022-10-01", 6.5e5), ("2023-06-01", 5.0e4), ("2024-06-01", 7.5e5),
                                         (end, 8.5e5)], rng, 0.02),
        "RRPONTSYD": _smooth_path(daily, [(start, 150), ("2018-01-01", 5), ("2021-03-01", 5),
                                          ("2022-12-30", 2550), ("2023-06-01", 2100), ("2024-12-31", 300),
                                          (end, 25)], rng, 0.02),
        "RMFSL": _smooth_path(monthly, [(start, 710), ("2020-01-01", 1050), ("2020-06-01", 1150),
                                        ("2022-06-01", 1020), ("2024-01-01", 1750), (end, 2150)], rng, 0.003),
        "M2SL": _smooth_path(monthly, [(start, 12400), ("2020-02-01", 15400), ("2022-04-01", 21700),
                                       ("2023-10-01", 20700), (end, 22600)], rng, 0.002),
        "CPIAUCSL": _smooth_path(monthly, [(start, 237.0), ("2020-12-01", 262.0), ("2022-06-01", 296.0),
                                           (end, 330.0)], rng, 0.0005),
    }
    for sid, knots in {
        "DTB3": [(start, 0.3), ("2018-12-01", 2.4), ("2020-04-01", 0.1), ("2022-01-01", 0.05), ("2023-08-01", 5.4), (end, 3.9)],
        "DGS10": [(start, 2.2), ("2020-08-01", 0.6), ("2022-10-20", 4.2), ("2023-10-19", 5.0), (end, 4.3)],
        "T10Y2Y": [(start, 1.2), ("2019-08-28", -0.05), ("2021-03-01", 1.5), ("2023-07-03", -1.05), (end, 0.5)],
        "DFII10": [(start, 0.7), ("2020-08-01", -1.1), ("2022-10-20", 1.7), ("2023-10-19", 2.5), (end, 1.9)],
        "BAMLH0A0HYM2": [("2023-10-31", 4.4), ("2024-12-01", 2.8), ("2025-04-08", 4.5), (end, 3.0)],
        "NFCI": [(start, -0.3), ("2020-03-20", 0.4), ("2021-06-01", -0.6), ("2022-10-01", 0.0), (end, -0.5)],
    }.items():
        first = pd.Timestamp(knots[0][0])
        index = pd.date_range(first, end, freq="W-FRI") if sid == "NFCI" else pd.bdate_range(first, end)
        macro[sid] = _smooth_path(index, knots, rng, 0.01)

    quarters = pd.date_range(start, end, freq="QS")
    macro["NCBEILQ027S"] = _smooth_path(quarters, [(start, 25.0e6), ("2020-01-01", 35e6), ("2020-04-01", 30e6),
                                                   ("2021-10-01", 52e6), ("2022-10-01", 42e6), (end, 80e6)], rng, 0.01)
    macro["BOGZ1LM793164105Q"] = _smooth_path(quarters, [(start, 6.0e6), ("2020-04-01", 6.5e6), (end, 26e6)], rng, 0.01)
    macro["HNOREMQ027S"] = _smooth_path(quarters, [(start, 25e6), ("2022-07-01", 41e6), ("2023-04-01", 40e6), (end, 48e6)], rng, 0.003)
    macro["CSUSHPISA"] = _smooth_path(monthly, [(start, 180), ("2022-06-01", 305), ("2023-01-01", 296), (end, 335)], rng, 0.002)
    macro["NCBDBIQ027S"] = _smooth_path(quarters, [(start, 6.0e6), ("2021-01-01", 7.6e6), (end, 9.2e6)], rng, 0.002)
    macro["MVMTD027MNFRBDAL"] = _smooth_path(monthly, [(start, 13600), ("2020-06-01", 20500), ("2022-10-01", 22000),
                                                       (end, 29800)], rng, 0.002)

    month_ends = pd.date_range(start, end, freq="ME")
    macro["MMF_TOTAL"] = _smooth_path(month_ends, [(start, 2750), ("2020-02-01", 3650), ("2020-05-01", 4800),
                                                   ("2022-06-01", 4600), ("2024-06-01", 6300), (end, 8300)], rng, 0.01)

    stable_days = pd.date_range(start, end, freq="D")
    stable = _smooth_path(stable_days, [(start, 0.01), ("2017-12-01", 1.5), ("2019-12-01", 5.5),
                                        ("2021-01-01", 28), ("2022-04-01", 187), ("2023-10-01", 122),
                                        ("2025-01-01", 205), (end, 310)], rng, 0.002)

    # Fund share counts: noisy daily creations and redemptions, out of stocks and junk
    # bonds and into havens during selloffs, and chasing recent returns otherwise.
    funds = {}
    for ticker, (size_bn, noise, tilt) in FUNDS.items():
        nav = prices[ticker]["close"]
        trailing = nav.pct_change(20).fillna(0.0).to_numpy()
        pct = noise * rng.standard_normal(n) + np.where(crash, tilt, 0.0) + 0.08 * trailing / 20 + 0.0002
        shares = size_bn * 1e9 / nav.iloc[0] * np.exp(np.cumsum(pct))
        df = pd.DataFrame({"nav": nav.to_numpy(), "shares": np.round(shares, -4)}, index=days)
        df["aum"] = df["nav"] * df["shares"]
        funds[ticker] = df[df.index >= FUND_START.get(ticker, start)]

    # Futures positioning: speculators lean with the trend and get squeezed in selloffs.
    trend = pd.Series(mkt, index=days).rolling(60, min_periods=5).sum()
    cftc = {}
    for key, (scale, oi, report) in {
        "sp500": (300e3, 2.0e6, "tff"), "nasdaq": (40e3, 2.5e5, "tff"), "ust10": (-500e3, 4.5e6, "tff"),
        "ustbond": (-150e3, 1.8e6, "tff"), "dollar": (15e3, 3.0e4, "tff"), "bitcoin": (-1.5e3, 2.5e4, "tff"),
        "gold": (150e3, 5.0e5, "disagg"), "crude": (200e3, 1.8e6, "disagg"),
        "vix": (-60e3, 4.0e5, "tff"), "yen": (-50e3, 2.5e5, "tff"), "euro": (60e3, 7.0e5, "tff"),
    }.items():
        # Weekly readings dated by their last day, so none sits in the future.
        weekly_trend = trend.dropna().groupby(pd.Grouper(freq="W-TUE")).tail(1)
        noise = np.cumsum(rng.standard_normal(len(weekly_trend))) * 0.05
        spec = scale * (np.tanh(weekly_trend.to_numpy() * 8) * 0.6 + noise)
        frame = pd.DataFrame({"spec_net": np.round(spec), "open_interest": oi * (1 + 0.1 * rng.standard_normal(len(spec)))},
                             index=weekly_trend.index)
        if report == "tff":
            frame["am_net"] = np.round(-0.8 * spec + scale * 2)
        cftc[key] = frame

    return {"prices": prices, "vix": vix, "macro": macro, "stable": stable, "funds": funds, "cftc": cftc}
