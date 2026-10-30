"""Temporary: check which issuer endpoints expose daily shares-outstanding history."""
import io, sys
import requests

H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
URLS = {
    "ssga_spy": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/navhist-us-en-spy.xlsx",
    "ssga_spy2": "https://www.ssga.com/us/en/intermediary/etfs/library-content/products/fund-data/etfs/us/navhist-us-en-spy.xlsx",
    "ssga_bil": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/navhist-us-en-bil.xlsx",
    "ishares_iwm": "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/1467271812596.ajax?fileType=xls&fileName=iShares-Russell-2000-ETF_fund&dataType=fund",
    "ishares_tlt": "https://www.ishares.com/us/products/239454/ishares-20-year-treasury-bond-etf/1467271812596.ajax?fileType=xls&fileName=iShares-20-Year-Treasury-Bond-ETF_fund&dataType=fund",
    "ishares_ibit": "https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf/1467271812596.ajax?fileType=xls&fileName=iShares-Bitcoin-Trust-ETF_fund&dataType=fund",
    "invesco_qqq": "https://www.invesco.com/us/financial-products/etfs/product-detail/main/sidebar/0?audienceType=Investor&action=download&ticker=QQQ",
    "invesco_api": "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/prices?idType=ticker&productType=ETF&interval=daily&startDate=2024-01-01&endDate=2024-02-01",
    "gld": "https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv",
    "cftc": "https://publicreporting.cftc.gov/resource/gpe5-46if.json?$limit=2&$order=report_date_as_yyyy_mm_dd%20DESC&$where=cftc_contract_market_code=%2713874A%27",
    "fred_hy": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2",
    "yahoo_ts": "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/SPY?type=annualSharesOutstanding&period1=1600000000&period2=1800000000",
}
for k, u in URLS.items():
    try:
        r = requests.get(u, headers=H, timeout=40)
        body = r.content
        print(f"## {k} status={r.status_code} type={r.headers.get('content-type')} len={len(body)}")
        if body[:2] == b"PK":
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(body), read_only=True)
            for ws in wb.worksheets[:3]:
                rows = list(ws.iter_rows(max_row=8, values_only=True))
                print("  sheet", ws.title, rows)
        else:
            txt = body.decode("utf-8", "replace")
            # iShares xls is SpreadsheetML: show the Historical part
            i = txt.find("Shares Outstanding")
            print("  head:", txt[:600].replace("\n", " "))
            if i >= 0:
                print("  SO@", i, txt[max(0, i - 300):i + 900].replace("\n", " "))
    except Exception as e:
        print(f"## {k} ERROR {e}")
sys.stdout.flush()
