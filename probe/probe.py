"""Temporary: real estate at market value and a monthly house price index."""
from pipeline.sources import fetch_fred

for sid in ["HNOREMQ027S", "BOGZ1LM155035015Q", "BOGZ1FL155035015Q", "BOGZ1LM115035005Q", "BOGZ1LM115035023Q",
            "BOGZ1LM105035005Q", "BOGZ1LM105035045Q", "TNWBSHNO", "CSUSHPISA", "USSTHPI", "RMFSL"]:
    try:
        s = fetch_fred(sid, "2016-01-01")
        print(f"## {sid} n={len(s)} first={s.index[0].date()} {s.iloc[0]:.1f} last={s.index[-1].date()} {s.iloc[-1]:.1f}")
    except Exception as e:
        print(f"## {sid} ERROR {e}")
