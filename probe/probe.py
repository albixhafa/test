"""Temporary: market value of US financial companies' shares, to add to nonfinancial."""
from pipeline.sources import fetch_fred

for sid in ["BOGZ1LM793164105Q", "BOGZ1FL793164105Q", "BOGZ1LM793164005Q", "BOGZ1LM893064125Q", "BOGZ1LM263164003Q", "BOGZ1LM263064003Q", "NCBEILQ027S"]:
    try:
        s = fetch_fred(sid, "2016-01-01")
        print(f"## {sid} n={len(s)} first={s.index[0].date()} {s.iloc[0]:.1f} last={s.index[-1].date()} {s.iloc[-1]:.1f}")
    except Exception as e:
        print(f"## {sid} ERROR {e}")
