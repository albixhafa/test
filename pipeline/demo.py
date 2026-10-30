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
    "EFA": (0.85, 0.004, 0.000, 1.5, 58),
    "EEM": (0.95, 0.006, -0.001, 1.2, 35),
    "XLP": (0.55, 0.004, 0.0015, 0.8, 50),
    "XLU": (0.45, 0.006, 0.0012, 1.0, 45),
    "BIL": (0.00, 0.0002, 0.0001, 0.6, 91),
    "IEF": (-0.15, 0.003, 0.0015, 1.5, 105),
    "TLT": (-0.30, 0.008, 0.0030, 3.0, 120),
    "LQD": (0.10, 0.003, 0.0005, 2.5, 110),
    "HYG": (0.40, 0.002, -0.0010, 3.0, 80),
    "GLD": (-0.05, 0.009, 0.0035, 1.8, 105),
    "DBC": (0.40, 0.010, -0.0010, 0.15, 14),
    "UUP": (-0.12, 0.003, 0.0020, 0.08, 25),
    "BTC-USD": (1.60, 0.030, -0.0020, 30.0, 430),
    "ETH-USD": (2.00, 0.040, -0.0030, 15.0, 1),
}
# Extra volume in selloffs; havens see the heaviest turnover relative to normal.
SELLOFF_VOLUME = {"BIL": 2.2, "GLD": 1.9, "TLT": 1.8, "IEF": 1.6, "UUP": 1.7, "XLP": 1.4, "XLU": 1.4}


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
    }
    stable_days = pd.date_range(start, end, freq="D")
    stable = _smooth_path(stable_days, [(start, 0.01), ("2017-12-01", 1.5), ("2019-12-01", 5.5),
                                        ("2021-01-01", 28), ("2022-04-01", 187), ("2023-10-01", 122),
                                        ("2025-01-01", 205), (end, 310)], rng, 0.002)
    return prices, vix, macro, stable
