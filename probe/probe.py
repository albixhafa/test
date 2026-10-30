"""Temporary: can we read weekly money market fund assets (ICI) or the OFR monitor?"""
import io
import re

from pipeline.sources import _get

for url in ["https://www.ici.org/research/stats/mmf", "https://www.ici.org/research/stats"]:
    try:
        r = _get(url, retries=1)
        html = r.text
        print("##", url, r.status_code, len(html))
        links = sorted(set(re.findall(r'href="([^"]+\.(?:xls|xlsx|csv))"', html)))
        print("  links:", links[:20])
        m = re.search(r"[Tt]otal money market fund assets[^.]{0,300}", html)
        print("  text:", m.group(0) if m else None)
        for link in links[:3]:
            full = link if link.startswith("http") else "https://www.ici.org" + link
            b = _get(full, retries=1).content
            print("  file", full, len(b), b[:8])
            if b[:2] == b"PK":
                import openpyxl
                for ws in openpyxl.load_workbook(io.BytesIO(b), read_only=True).worksheets[:2]:
                    print("   sheet", ws.title, [r[:8] for r in ws.iter_rows(max_row=12, values_only=True)])
            else:
                try:
                    import pandas as pd
                    x = pd.read_excel(io.BytesIO(b), sheet_name=None, header=None, nrows=14)
                    for k, v in list(x.items())[:2]:
                        print("   sheet", k, v.iloc[:14, :8].values.tolist())
                except Exception as e:
                    print("   xls read error", e)
    except Exception as e:
        print("##", url, "ERROR", e)

for mn in ["MMF-MMF_TOT-M", "MMF-MMF_TOT_ASSETS-M"]:
    try:
        r = _get("https://data.financialresearch.gov/v1/series/timeseries", {"mnemonic": mn}, retries=1)
        print("## ofr", mn, r.status_code, r.text[:300])
    except Exception as e:
        print("## ofr", mn, "ERROR", e)
try:
    r = _get("https://data.financialresearch.gov/v1/metadata/search", {"query": "money market fund total assets"}, retries=1)
    print("## ofr search", r.text[:1500])
except Exception as e:
    print("## ofr search ERROR", e)
