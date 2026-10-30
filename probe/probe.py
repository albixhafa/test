"""Temporary: which FRED series give the size of US stocks and bonds, and gold futures."""
from pipeline.sources import fetch_fred, fetch_yahoo

for sid in ["BOGZ1LM893064105Q", "BOGZ1FL893064105Q", "NCBEILQ027S", "BOGZ1LM103164103Q", "WILL5000PRFC",
            "MVMTD027MNFRBDAL", "BOGZ1FL893163005Q", "BOGZ1LM893163005Q", "NCBDBIQ027S", "GFDEBTN",
            "BOGZ1FL894104005Q", "BOGZ1LM894104005Q", "M2SL"]:
    try:
        s = fetch_fred(sid, "2016-01-01")
        print(f"## {sid} n={len(s)} first={s.index[0].date()} {s.iloc[0]:.1f} last={s.index[-1].date()} {s.iloc[-1]:.1f}")
    except Exception as e:
        print(f"## {sid} ERROR {e}")
for t in ["GC=F"]:
    try:
        df = fetch_yahoo(t, "2016-01-01")
        print(f"## {t} n={len(df)} first={df.index[0].date()} {df['close'].iloc[0]:.1f} last={df.index[-1].date()} {df['close'].iloc[-1]:.1f}")
    except Exception as e:
        print(f"## {t} ERROR {e}")
