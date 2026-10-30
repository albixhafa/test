"""Temporary: which SPDR funds publish NAV history, and which CFTC futures we can read."""
import io

import openpyxl

from pipeline.sources import _get

SS = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/navhist-us-en-{}.xlsx"
for t in ["spy", "gld", "xlk", "xlf", "xle", "jnk", "spti", "sptl", "spbo", "xlp"]:
    try:
        body = _get(SS.format(t)).content
        ws = openpyxl.load_workbook(io.BytesIO(body), read_only=True).worksheets[0]
        rows = [x[:4] for x in ws.iter_rows(values_only=True) if x[0] is not None]
        print(f"## ssga {t} rows={len(rows)}", rows[3:5], rows[-2:])
    except Exception as e:
        print(f"## ssga {t} ERROR {e}")

base = "https://publicreporting.cftc.gov/resource/{}.json"
for ds, codes in {"gpe5-46if": ["13874A", "043602", "020601", "098662", "133741", "209742"], "72hh-3qpy": ["088691", "067651"]}.items():
    for c in codes:
        try:
            j = _get(base.format(ds), params={"$limit": 1, "$order": "report_date_as_yyyy_mm_dd DESC", "cftc_contract_market_code": c}).json()
            print("## cftc", ds, c, j[0]["market_and_exchange_names"] if j else None, j[0]["report_date_as_yyyy_mm_dd"] if j else None)
            if j and c in ("13874A", "088691"):
                print("   keys", sorted(k for k in j[0] if "pct" not in k and "conc" not in k))
        except Exception as e:
            print("## cftc", c, "ERROR", e)
try:
    print("## cftc spx rows", _get(base.format("gpe5-46if"), params={"$select": "min(report_date_as_yyyy_mm_dd)", "cftc_contract_market_code": "13874A"}).text)
except Exception as e:
    print("## cftc count ERROR", e)
for sid in ["BAMLH0A0HYM2", "DGS10", "DGS2", "NFCI"]:
    try:
        txt = _get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": sid}).text
        print("## fred", sid, txt.splitlines()[1], txt.splitlines()[-1])
    except Exception as e:
        print("## fred", sid, "ERROR", e)
