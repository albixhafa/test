"""Temporary: OFR money market fund monitor series and freshness."""
from pipeline.sources import _get

B = "https://data.financialresearch.gov/v1"
for path, params in [("/metadata/mnemonics", {"dataset": "mmf"}), ("/series/dataset", {"dataset": "mmf"})]:
    try:
        r = _get(B + path, params, retries=1)
        print("##", path, r.status_code, len(r.text))
        print(r.text[:6000])
    except Exception as e:
        print("##", path, "ERROR", e)
r = _get(B + "/series/timeseries", {"mnemonic": "MMF-MMF_TOT-M"}, retries=1).json()
print("## total last", r[-4:], "count", len(r))
