"use strict";

const state = { data: null, charts: {}, assets: {}, groupIndex: {} };
// Money entering the tracked funds from outside, or leaving them altogether.
const SIDELINES = "Sidelines";
// One market per class for the performance chart.
const REPRESENTATIVES = ["SPY", "SPTL", "UUP", "GLD", "BTC-USD"];

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function theme() {
  return {
    surface: css("--surface"),
    text: css("--text-primary"),
    text2: css("--text-secondary"),
    muted: css("--muted"),
    grid: css("--grid"),
    axis: css("--axis"),
    border: css("--border"),
    wash: css("--wash"),
    pos: css("--pos"),
    neg: css("--neg"),
    mid: css("--mid"),
    cash: css("--cash-node"),
    groups: [1, 2, 3, 4, 5, 6, 7].map((i) => css(`--series-${i}`)),
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const MINUS = "−";

function fmtPct(x, digits = 1, signed = true) {
  if (x == null || !isFinite(x)) return "–";
  const v = (x * 100).toFixed(digits);
  const sign = x > 0 && signed ? "+" : "";
  return (sign + v + "%").replace("-", MINUS);
}

function fmtUsdBn(x, signed = false) {
  if (x == null || !isFinite(x)) return "–";
  const abs = Math.abs(x);
  // Thresholds sit at the rounding boundaries so 999.7 reads $1.00T, never $1000B.
  const body = abs >= 999.5 ? `$${(abs / 1000).toFixed(2)}T` : abs >= 9.95 ? `$${abs.toFixed(0)}B` : `$${abs.toFixed(1)}B`;
  if (x < 0) return MINUS + body;
  return (signed && x > 0 ? "+" : "") + body;
}

// Axis ticks: no trailing zeros ($1.5T, $500B, $0).
function fmtAxisUsd(v) {
  if (!v) return "$0";
  const abs = Math.abs(v);
  const body = abs >= 1000 ? `$${Number((abs / 1000).toFixed(2))}T` : `$${Number(abs.toFixed(1))}B`;
  return v < 0 ? MINUS + body : body;
}

function parseDay(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function fmtDate(iso, withYear = true) {
  if (!iso) return "–";
  return parseDay(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC",
  });
}

function fmtMonth(iso) {
  return parseDay(iso).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtRange(a, b) {
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${fmtDate(a, !sameYear)} – ${fmtDate(b)}`;
}

function shortName(ticker) {
  return state.assets[ticker] ? state.assets[ticker].short || state.assets[ticker].name : ticker;
}

function narrowScreen() {
  return window.innerWidth < 560;
}

function fmtNum(x, digits = 2, signed = false) {
  if (x == null || !isFinite(x)) return "–";
  return ((signed && x > 0 ? "+" : "") + x.toFixed(digits)).replace("-", MINUS);
}

function assetName(ticker) {
  if (ticker === SIDELINES) return SIDELINES;
  return state.assets[ticker] ? state.assets[ticker].name : ticker;
}

function groupColor(t, g) {
  return g === SIDELINES ? t.cash : t.groups[(state.groupIndex[g] ?? 0) % t.groups.length];
}

function assetColor(ticker, t) {
  if (ticker === SIDELINES) return t.cash;
  const a = state.assets[ticker];
  return a ? groupColor(t, a.group) : t.muted;
}

// Markets with real flow data, and markets with a real price (stablecoins have only supply).
function flowTickers() {
  return state.data.assets.filter((a) => a.flows).map((a) => a.ticker);
}

function pricedAssets() {
  return state.data.assets.filter((a) => a.ticker !== "STABLES");
}

function tooltipBase(t) {
  return {
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.text, fontSize: 12, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
    extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px;",
  };
}

function axisStyle(t) {
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid } },
  };
}

function row(label, value, color) {
  const key = color ? `<span style="display:inline-block;width:10px;height:2px;background:${color};margin-right:6px;vertical-align:middle"></span>` : "";
  return `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:inherit;opacity:.75">${key}${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function chart(id) {
  const el = document.getElementById(id);
  if (!state.charts[id]) {
    state.charts[id] = echarts.init(el, null, { renderer: "svg" });
  }
  return state.charts[id];
}

function table(container, headers, rows) {
  const tbl = document.createElement("table");
  const thead = tbl.createTHead().insertRow();
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    thead.appendChild(th);
  });
  const body = tbl.createTBody();
  rows.forEach((r) => {
    const tr = body.insertRow();
    r.forEach((cell) => {
      tr.insertCell().textContent = cell;
    });
  });
  container.replaceChildren(tbl);
}

function cardTable(card) {
  return document.querySelector(`[data-card="${card}"] .table-wrap`);
}

function selloffBands(t) {
  const eps = state.data.selloffs.episodes;
  return {
    silent: true,
    itemStyle: { color: t.wash },
    data: eps.map((e) => [{ xAxis: e.peak }, { xAxis: e.trough }]),
  };
}

// ---------- date range: one selection drives every chart and table ----------

const RANGE_PRESETS = [
  ["1W", "1W", "over the past week", "in the past week"],
  ["1M", "1M", "over the past month", "in the past month"],
  ["3M", "3M", "over the past 3 months", "in the past 3 months"],
  ["6M", "6M", "over the past 6 months", "in the past 6 months"],
  ["YTD", "YTD", "so far this year", "so far this year"],
  ["1Y", "1Y", "over the past year", "in the past year"],
  ["3Y", "3Y", "over the past 3 years", "in the past 3 years"],
  ["5Y", "5Y", "over the past 5 years", "in the past 5 years"],
  ["ALL", "All", "over all available history", "over all available history"],
];
const RANGE_INFO = Object.fromEntries(RANGE_PRESETS.map(([k, label, span, hub]) => [k, { label, span, hub }]));

state.range = { preset: "1M", start: null, end: null };

function addMonths(iso, n) {
  const d = parseDay(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

// Bounds of the selected range as ISO dates. Presets count back from the latest data;
// their start is exclusive (1W = the five trading days after a date a week ago).
function rangeBounds() {
  const end = state.data.meta.as_of;
  const p = state.range.preset;
  const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60 };
  if (p === "custom") return { start: state.range.start, end: state.range.end || end, inclusive: true };
  if (p === "1W") return { start: shiftDate(end, -7), end };
  if (p === "YTD") return { start: `${end.slice(0, 4)}-01-01`, end, inclusive: true };
  if (p === "ALL") return { start: "2000-01-01", end, inclusive: true };
  return { start: addMonths(end, -months[p]), end };
}

function inRange(iso, b = rangeBounds()) {
  return (b.inclusive ? iso >= b.start : iso > b.start) && iso <= b.end;
}

// A period [a, z] overlaps the range (used for months, weeks and selloffs).
function overlapsRange(a, z, b = rangeBounds()) {
  return z >= b.start && a <= b.end;
}

function rangeSpan() {
  if (state.range.preset !== "custom") return RANGE_INFO[state.range.preset].span;
  const b = rangeBounds();
  return `between ${fmtDate(b.start)} and ${fmtDate(b.end)}`;
}

function rangeHub() {
  if (state.range.preset !== "custom") return `moved ${RANGE_INFO[state.range.preset].hub}`;
  return "moved in the selected range";
}

function rangeShort() {
  if (state.range.preset !== "custom") return RANGE_INFO[state.range.preset].label;
  const b = rangeBounds();
  return fmtRange(b.start, b.end);
}

// Compact wording for tiles: "over the past month", or "over Feb 1 – Apr 30, 2020".
function rangeTileSpan() {
  return state.range.preset === "custom" ? `over ${rangeShort()}` : rangeSpan();
}

function rangeDays(b = rangeBounds()) {
  return (parseDay(b.end) - parseDay(b.start < "2016-01-01" ? "2016-01-01" : b.start)) / 864e5;
}

// ---------- inflation adjustment ----------

state.real = false;

// CPI level for the month of an ISO date. Months after the latest release use the latest
// level, months before the first use the first.
function cpiAt(iso) {
  const c = state.data.cpi;
  if (!c || !c.length) return null;
  if (!state.cpiMap) state.cpiMap = new Map(c.map(([d, v]) => [d.slice(0, 7), v]));
  const v = state.cpiMap.get(iso.slice(0, 7));
  if (v != null) return v;
  return iso < c[0][0] ? c[0][1] : c[c.length - 1][1];
}

function cpiLatest() {
  const c = state.data.cpi;
  return c && c.length ? c[c.length - 1] : null;
}

// Multiply a dollar amount from `iso` by this to express it in today's dollars.
function deflator(iso) {
  if (!state.real) return 1;
  const now = cpiLatest();
  const then = cpiAt(iso);
  return now && then ? now[1] / then : 1;
}

// A price from `iso` in today's dollars; ratios of these are real (after-inflation) returns.
function realPrice(price, iso) {
  return price == null ? null : price * deflator(iso);
}

function realPoints(pts) {
  return state.real ? pts.map(([d, v]) => [d, v == null ? null : v * deflator(d)]) : pts;
}

function scaleWheel(wheel, k) {
  if (!wheel || k === 1) return wheel;
  return {
    net: Object.fromEntries(Object.entries(wheel.net).map(([g, v]) => [g, v * k])),
    links: wheel.links.map((l) => ({ ...l, value: l.value * k })),
    total_bn: wheel.total_bn * k,
  };
}

function scaleNets(nets, k) {
  return nets && k !== 1 ? Object.fromEntries(Object.entries(nets).map(([t, v]) => [t, v == null ? null : v * k])) : nets;
}

function dollarsNote() {
  const c = cpiLatest();
  return state.real && c ? ` Inflation-adjusted to ${fmtMonth(c[0])} dollars.` : "";
}

// Sum flows and measure the price change for every market over the range; flow as a
// share of fund size uses the size at the start. Uses daily rows when the range fits in
// the last three years, monthly otherwise.
function aggregate(b = rangeBounds()) {
  const key = `${b.start}|${b.end}|${b.inclusive ? 1 : 0}|${state.real ? 1 : 0}`;
  if (state.aggCache && state.aggCache.key === key) return state.aggCache.value;
  const S = state.data.series;
  const D = S.daily;
  const daily = b.start >= D.dates[0];
  const rows = [];
  let src;
  if (daily) {
    src = D;
    D.dates.forEach((d, i) => { if (inRange(d, b)) rows.push(i); });
  } else {
    src = S.monthly;
    src.end.forEach((e, i) => { if (overlapsRange(src.start[i], e, b)) rows.push(i); });
  }
  const assets = {};
  if (rows.length) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const dates = daily ? D.dates : src.end;
    const k = rows.map((i) => deflator(dates[i]));
    Object.keys(src.close).forEach((t) => {
      const sum = (arr) => rows.reduce((acc, i, j) => acc + (arr[i] || 0) * k[j], 0);
      const flows = src.flow[t];
      const hasFlow = flows && rows.some((i) => flows[i] != null);
      const net = hasFlow ? sum(flows) : null;
      const sizes = src.aum[t];
      const size = hasFlow ? rows.map((i) => sizes[i]).find((v) => v != null) : null;
      const closes = src.close[t];
      let before = first > 0 ? realPrice(closes[first - 1], dates[first - 1]) : null;
      if (before == null) {
        const j = closes.slice(first, last + 1).findIndex((v) => v != null);
        before = j >= 0 ? realPrice(closes[first + j], dates[first + j]) : null;
      }
      const after = realPrice(closes[last], dates[last]);
      assets[t] = {
        net_flow_bn: net,
        aum_bn: size == null ? null : size * k[0],
        ret: before && after ? after / before - 1 : null,
        intensity: net != null && size > 0 ? net / (size * k[0]) : null,
      };
    });
  }
  const value = {
    granularity: daily ? "daily" : "monthly",
    start: rows.length ? (daily ? D.dates[rows[0]] : src.start[rows[0]]) : b.start,
    end: rows.length ? (daily ? D.dates[rows[rows.length - 1]] : src.end[rows[rows.length - 1]]) : b.end,
    periods: rows.length,
    assets,
  };
  state.aggCache = { key, value };
  return value;
}

// Port of pipeline/analytics.py allocate_flows: split each net outflow across net
// inflows in proportion to size; any imbalance goes to or from the sidelines.
function allocateFlows(net, minShare = 0.002) {
  const sources = Object.entries(net).filter(([, v]) => v != null && v < 0).map(([k, v]) => [k, -v]);
  const sinks = Object.entries(net).filter(([, v]) => v != null && v > 0);
  const totalOut = sources.reduce((a, [, v]) => a + v, 0);
  const totalIn = sinks.reduce((a, [, v]) => a + v, 0);
  let links = [];
  if (totalOut > 0 && totalIn > 0) {
    const matched = Math.min(totalOut, totalIn);
    sources.forEach(([s, out]) => sinks.forEach(([d, inn]) => links.push({ source: s, target: d, value: matched * (out / totalOut) * (inn / totalIn) })));
  }
  if (totalOut > totalIn) sources.forEach(([s, out]) => links.push({ source: s, target: SIDELINES, value: (totalOut - totalIn) * out / totalOut }));
  else if (totalIn > totalOut) sinks.forEach(([d, inn]) => links.push({ source: SIDELINES, target: d, value: (totalIn - totalOut) * inn / totalIn }));
  const scale = Math.max(totalOut, totalIn, 1e-12);
  links = links.filter((l) => l.value / scale >= minShare);
  return { links, total_out_bn: totalOut, total_in_bn: totalIn };
}

// Port of class_flows: net within each class; the sidelines balance the rest.
function classFlows(assetNets) {
  const groups = state.data.groups;
  const net = Object.fromEntries(groups.map((g) => [g, 0]));
  Object.entries(assetNets).forEach(([t, v]) => {
    const a = state.assets[t];
    if (v == null || !isFinite(v) || !a || a.group === SIDELINES) return;
    net[a.group] += v;
  });
  net[SIDELINES] = -groups.filter((g) => g !== SIDELINES).reduce((acc, g) => acc + net[g], 0);
  const links = allocateFlows(net).links;
  return { net, links, total_bn: links.reduce((a, l) => a + l.value, 0) };
}

// ---------- plain-language help ----------

const INFO = {
  regime: "A blend of six signals: stocks, small vs big companies, risky vs safe bonds, bitcoin, the dollar and the VIX, each compared with its own past year. Above +0.5 investors are reaching for risk; below −0.5 they are running from it.",
  spy: "The 500 largest US companies. Shows the change over the past month and how far the index sits below its highest close of the past year.",
  vix: "The market's expected swings in the S&P 500 over the next 30 days, priced from options. Around 12–20 is calm; above 30 is fear.",
  btc: "Bitcoin's price change over the past month. It tends to move with investors' appetite for risk.",
  stablecoins: "Crypto tokens pegged to the dollar, such as USDT and USDC. Their total supply is cash sitting on crypto rails, ready to buy.",
  retail_mmf: "Money market funds held by households: where savers park cash that isn't in stocks or bonds. A rising total is money on the sidelines.",
  net_liquidity: "The Federal Reserve's balance sheet minus the Treasury's cash account and the reverse repo facility. A rough gauge of cash available to markets; when it rises, asset prices tend to get support.",
  rrp: "Money market funds lending spare cash to the Fed overnight. A big balance means idle cash; it drained toward zero as that cash moved into T-bills and markets.",
  tga: "The US government's checking account at the Fed. When it fills up, cash is pulled out of banks and markets; when it is spent down, cash flows back.",
  flows: "Real money, not estimates. Every State Street SPDR fund reports its shares outstanding daily; new shares times the share price is money put in, cancelled shares money taken out. Crypto's flow is the change in total stablecoin supply. SPDR funds are a large, consistent slice of US ETFs, not the whole market, so read sizes as a sample and directions as the signal. Markets without an SPDR fund (Nasdaq 100, small caps, bitcoin, the dollar) are tracked for price only.",
  intensity: "Net flow divided by the fund's size at the start of the range. It puts a $50B fund and an $800B fund on the same scale: +5% means the fund grew 5% from new money alone, before any price change.",
};

function showInfo(title, text, x, y) {
  const tip = $("#tip");
  tip.replaceChildren();
  const head = document.createElement("div");
  head.className = "tip-title";
  head.textContent = title;
  const body = document.createElement("div");
  body.className = "tip-text";
  body.textContent = text;
  tip.append(head, body);
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(x - box.width / 2, window.innerWidth - box.width - 8))}px`;
  tip.style.top = `${y + 14 + box.height > window.innerHeight ? y - box.height - 14 : y + 14}px`;
}

// A small (i) button that explains a term on hover, focus or tap.
function infoButton(title, key) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "info";
  btn.textContent = "i";
  btn.setAttribute("aria-label", `What is ${title}?`);
  const open = () => {
    const r = btn.getBoundingClientRect();
    showInfo(title, INFO[key], r.left + r.width / 2, r.bottom - 6);
  };
  btn.addEventListener("mouseenter", open);
  btn.addEventListener("focus", open);
  btn.addEventListener("click", (ev) => { ev.stopPropagation(); open(); });
  btn.addEventListener("mouseleave", hideTip);
  btn.addEventListener("blur", hideTip);
  return btn;
}

function relativeTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

// ---------- right now: the page in five plain sentences ----------

const SIGNAL_TEXT = {
  "Equities": ["Stocks have had an unusually strong month.", "Stocks have had an unusually weak month."],
  "Small vs large caps": ["Small companies are beating big ones, a sign of broad confidence.", "Small companies are lagging big ones: investors are getting choosier."],
  "Credit vs Treasuries": ["Riskier bonds are beating safe Treasuries: credit markets are relaxed.", "Riskier bonds are lagging safe Treasuries, which often comes before stress in stocks."],
  "Bitcoin": ["Crypto is unusually strong.", "Crypto is under unusual pressure."],
  "Dollar (inverted)": ["The dollar is weakening unusually fast, which usually helps risk assets.", "The dollar is rising unusually fast, a classic flight to safety."],
  "Volatility (inverted)": ["Expected volatility is unusually low: markets are calm.", "Expected volatility (VIX) is unusually high: markets are nervous."],
};

const REGIME_TEXT = {
  "Risk-on": "investors are reaching for risk",
  "Risk-off": "investors are running from risk",
  "Neutral": "no strong rush into or out of risk",
  "Unknown": "not enough data to judge",
};

function renderNow() {
  const d = state.data;
  const k = d.kpis;
  const items = [];
  const eps = d.selloffs.episodes;
  const last = eps[eps.length - 1];
  if (last && last.ongoing) {
    items.push(["Stocks are in a selloff: ", `the S&P 500 is ${fmtPct(-Math.abs(k.drawdown), 1).replace("+", "")} from its high, which it hit on ${fmtDate(last.peak)}. The typical selloff since 2016 bottomed around ${fmtPct(median(eps.filter((e) => !e.ongoing).map((e) => e.drawdown)), 0)}.`]);
  } else {
    items.push(["No selloff under way: ", `the S&P 500 is ${fmtPct(k.drawdown, 1).replace(MINUS, "")} below its 1-year high and ${fmtPct(k.spy_20d)} over the past month.`]);
  }
  items.push([`Mood: ${d.regime.label}. `, `${REGIME_TEXT[d.regime.label] || ""} (score ${fmtNum(d.regime.score, 2, true)}).`]);
  const month = { wheel: d.windows["20"].wheel, span: "over the past month" };
  items.push(["Money flow: ", `${wheelHeadline(month)}.`]);
  const crowded = (d.positioning || []).map((p) => ({ p, c: crowding(p, { end: d.meta.as_of }) }))
    .filter((r) => r.c && (r.c.pct >= 85 || r.c.pct <= 15))
    .sort((a, z) => Math.abs(z.c.pct - 50) - Math.abs(a.c.pct - 50));
  if (crowded.length) {
    items.push(["Positioning extremes: ", `speculators are ${crowded.slice(0, 3).map((r) => `${extremeWord(r.c.pct, r.c.net)} in ${r.p.name.replace(" futures", "").replace(/^Long Treasury bond$/, "long Treasury bonds")} (${ordinal(r.c.pct)} percentile of three years)`).join("; ")}. Positions at an extreme can unwind fast.`]);
  }
  const rate = (k) => {
    const pts = d.rates && d.rates[k] && d.rates[k].points;
    if (!pts || pts.length < 5) return null;
    const last = pts[pts.length - 1];
    const ago = pts.filter((x) => x[0] <= shiftDate(last[0], -28)).pop();
    return { v: last[1], chg: ago ? last[1] - ago[1] : null };
  };
  const y10 = rate("DGS10");
  const hy = rate("BAMLH0A0HYM2");
  if (y10) {
    items.push(["Rates and credit: ", `the 10-year Treasury yields ${fmtRate(y10.v, "pct")} (${fmtRateChange(y10.chg, "pct")} in a month)${hy ? `, and junk bonds pay ${fmtRate(hy.v, "pct")} over Treasuries (${fmtRateChange(hy.chg, "pct")}${hy.chg > 0.25 ? ", lenders getting nervous" : hy.chg < -0.25 ? ", lenders relaxed" : ""})` : ""}.`]);
  }
  const mmf = d.cash.retail_mmf;
  if (mmf && mmf.length > 12) {
    const now = mmf[mmf.length - 1][1];
    const yearAgo = (mmf.find((x) => x[0] >= shiftDate(mmf[mmf.length - 1][0], -365)) || mmf[0])[1];
    items.push(["Cash on the sidelines: ", `households hold ${fmtUsdBn(now)} in money funds, ${fmtUsdBn(now - yearAgo, true)} in a year${k.stablecoins_bn ? `, and stablecoins hold ${fmtUsdBn(k.stablecoins_bn)}` : ""}.`]);
  }
  const strong = Object.entries(d.regime.components)
    .filter(([name, z]) => z != null && Math.abs(z) >= 1.5 && SIGNAL_TEXT[name])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (strong.length) {
    items.push(["Worth watching: ", strong.slice(0, 2).map(([name, z]) => SIGNAL_TEXT[name][z > 0 ? 0 : 1]).join(" ")]);
  }
  const list = $("#now-list");
  list.replaceChildren();
  items.forEach(([lead, text]) => {
    const li = document.createElement("li");
    const b = document.createElement("strong");
    b.textContent = lead;
    li.append(b, document.createTextNode(text));
    list.appendChild(li);
  });
}

function median(xs) {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ---------- KPI tiles ----------

function renderKpis() {
  const d = state.data;
  const k = d.kpis;
  const agg = aggregate().assets;
  // Latest level, with the change over the selected range underneath.
  const cashTile = (key, label) => {
    const pts = d.cash[key] ? realPoints(d.cash[key]) : null;
    const [value] = pts ? changeOverRange(pts) : [null];
    return { info: key, label, value: fmtUsdBn(value), delta: pts ? cashDelta(pts) : "No data" };
  };
  const r = d.regime;
  const pos = Math.max(-2, Math.min(2, r.score ?? 0));
  const tiles = [
    {
      info: "regime",
      label: "Risk regime",
      value: r.label,
      delta: `Score ${fmtNum(r.score, 2, true)}`,
      gauge: ((pos + 2) / 4) * 100,
    },
    { info: "spy", label: `S&P 500, ${rangeShort()}${state.real ? ", real" : ""}`, value: fmtPct(agg.SPY && agg.SPY.ret), delta: `${fmtPct(k.drawdown)} from 1-year high` },
    { info: "vix", label: "VIX", value: fmtNum(k.vix, 1), delta: "Implied S&P 500 volatility" },
    { info: "btc", label: `Bitcoin, ${rangeShort()}${state.real ? ", real" : ""}`, value: fmtPct(agg["BTC-USD"] && agg["BTC-USD"].ret), delta: "Crypto risk appetite" },
    cashTile("stablecoins", "Stablecoin supply"),
    cashTile("retail_mmf", "Money funds"),
    cashTile("net_liquidity", "Fed net liquidity"),
  ];
  const root = $("#kpis");
  root.replaceChildren();
  tiles.forEach((tile) => {
    const el = document.createElement("div");
    el.className = "kpi";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = tile.label;
    if (tile.info) label.appendChild(infoButton(tile.label, tile.info));
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = tile.value;
    const delta = document.createElement("span");
    delta.className = "delta";
    delta.textContent = tile.delta;
    el.append(label, value);
    if (tile.gauge != null) {
      const g = document.createElement("div");
      g.className = "gauge";
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", `Risk score ${fmtNum(r.score, 2, true)} on a scale from −2 to +2`);
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.left = `${tile.gauge}%`;
      g.appendChild(dot);
      const scale = document.createElement("div");
      scale.className = "gauge-scale";
      ["Risk-off", "Risk-on"].forEach((s) => {
        const sp = document.createElement("span");
        sp.textContent = s;
        scale.appendChild(sp);
      });
      el.append(g, scale);
    }
    el.append(delta);
    root.appendChild(el);
  });
}

// ---------- liquidity wheel ----------


function showTip(title, rows, x, y) {
  const tip = $("#tip");
  tip.replaceChildren();
  const head = document.createElement("div");
  head.className = "tip-title";
  head.textContent = title;
  tip.appendChild(head);
  rows.forEach(([label, value]) => {
    const r = document.createElement("div");
    r.className = "tip-row";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("strong");
    v.textContent = value;
    r.append(l, v);
    tip.appendChild(r);
  });
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const left = Math.min(x + 14, window.innerWidth - box.width - 8);
  const top = y + 14 + box.height > window.innerHeight ? y - box.height - 14 : y + 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

function hideTip() {
  $("#tip").hidden = true;
}

// "the sidelines" reads naturally in a sentence; class names stay as they are.
function className(g) {
  return g === SIDELINES ? "the sidelines" : g;
}

function wheelHeadline(view) {
  const wheel = view.wheel;
  const entries = Object.entries(wheel.net).sort((a, b) => a[1] - b[1]);
  const [source, out] = entries[0];
  if (!wheel.links.length || out >= 0) return `Little money changed hands between classes ${view.span}`;
  const dests = wheel.links.filter((l) => l.source === source).sort((a, b) => b.value - a.value).slice(0, 2);
  const where = dests.map((l) => `${className(l.target)} (${fmtUsdBn(l.value)})`).join(" and ");
  if (source === SIDELINES) return `${fmtUsdBn(-out)} of new money came in ${view.span}, mostly into ${where}`;
  return `${fmtUsdBn(-out)} left ${source} ${view.span}, mostly into ${where}`;
}

// ---------- wheel views: the current window, a past week or month, or a past selloff ----------

state.replay = null;

function rangeView() {
  const agg = aggregate();
  const marketNets = Object.fromEntries(Object.entries(agg.assets).map(([t, a]) => [t, a.net_flow_bn]));
  return {
    start: agg.start, end: agg.end, wheel: classFlows(marketNets),
    span: rangeSpan(), hub: rangeHub(), marketNets, granularity: agg.granularity,
  };
}

// One period of flow history (a day, week or month) by its index in the source data.
function periodAt(kind, i) {
  const groups = state.data.groups;
  if (kind === "daily") {
    const D = state.data.series.daily;
    const k = deflator(D.dates[i]);
    const marketNets = Object.fromEntries(Object.entries(D.flow).map(([t, v]) => [t, v[i] == null ? null : v[i] * k]));
    return { start: D.dates[i], end: D.dates[i], wheel: classFlows(marketNets), marketNets };
  }
  const h = state.data.history[kind];
  const wheel = {
    net: Object.fromEntries(groups.map((g) => [g, h.net[g][i]])),
    links: h.links[i].map(([a, b, v]) => ({ source: groups[a], target: groups[b], value: v })),
    total_bn: h.total[i],
  };
  let marketNets = null;
  if (kind === "weekly" && state.data.markets_weekly) {
    const mw = state.data.markets_weekly;
    const j = mw.end.indexOf(h.end[i]);
    if (j >= 0) marketNets = Object.fromEntries(Object.entries(mw.net).map(([t, v]) => [t, v[j]]));
  } else if (kind === "monthly") {
    const M = state.data.series.monthly;
    const j = M.end.indexOf(h.end[i]);
    if (j >= 0) marketNets = Object.fromEntries(Object.entries(M.flow).map(([t, v]) => [t, v[j]]));
  }
  const k = deflator(h.end[i]);
  return { start: h.start[i], end: h.end[i], wheel: scaleWheel(wheel, k), marketNets: scaleNets(marketNets, k) };
}

// Source indices of the periods that fall in the selected range.
function periodsInRange(kind) {
  const b = rangeBounds();
  if (kind === "daily") {
    return state.data.series.daily.dates.map((d, i) => (inRange(d, b) ? i : -1)).filter((i) => i >= 0);
  }
  const h = state.data.history[kind];
  return h.end.map((e, i) => (overlapsRange(h.start[i], e, b) ? i : -1)).filter((i) => i >= 0);
}

function historyView(kind, i) {
  const p = periodAt(kind, i);
  const names = {
    daily: () => fmtDate(p.end),
    weekly: () => `the week of ${fmtDate(p.start)}`,
    monthly: () => parseDay(p.end).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
  };
  const name = names[kind]();
  return {
    ...p,
    span: `on ${name}`.replace("on the week", "in the week").replace(/^on ([A-Z][a-z]+ \d{4})$/, "in $1"),
    hub: { daily: "moved that day", weekly: "moved that week", monthly: "moved that month" }[kind],
    label: kind === "weekly" ? `Week of ${fmtDate(p.start)}` : name,
    key: `${kind}:${p.end}`,
  };
}

// A selloff with returns made real (after inflation) and flows in today's dollars.
function realEpisode(e) {
  if (!state.real) return e;
  const over = cpiAt(e.peak) / cpiAt(e.trough);
  const after = cpiAt(e.trough) / cpiAt(shiftDate(e.trough, 28));
  const k = deflator(e.trough);
  const assets = Object.fromEntries(Object.entries(e.assets).map(([t, a]) => [t, {
    ...a,
    ret: a.ret == null ? null : (1 + a.ret) * over - 1,
    rebound: a.rebound == null ? null : (1 + a.rebound) * after - 1,
    net_flow_bn: a.net_flow_bn == null ? null : a.net_flow_bn * k,
  }]));
  return { ...e, drawdown: (1 + e.drawdown) * over - 1, assets, wheel: scaleWheel(e.wheel, k), _src: e };
}

function episodeView(i) {
  const e = realEpisode(state.data.selloffs.episodes[i]);
  return {
    start: e.peak, end: e.trough, wheel: e.wheel,
    span: `during the ${fmtMonth(e.peak)} selloff`,
    hub: "moved during the selloff",
    label: `${fmtMonth(e.peak)} selloff: S&P 500 ${fmtPct(e.drawdown, 0)}${e.ongoing ? " (still going)" : ""}`,
    key: `ep:${i}`,
    marketNets: Object.fromEntries(Object.entries(e.assets).map(([t, a]) => [t, a.net_flow_bn])),
  };
}

function currentView() {
  return state.replay || rangeView();
}

function replay(view, scroll = true) {
  state.replay = view;
  syncReplayControls();
  writeHash();
  safely("liquidity wheel", renderWheel, theme());
  if (scroll) document.querySelector('[data-card="wheel"]').scrollIntoView({ behavior: "smooth", block: "start" });
}

function exitReplay() {
  state.replay = null;
  syncReplayControls();
  writeHash();
  safely("liquidity wheel", renderWheel, theme());
}

function syncReplayControls() {
  const bar = $("#replay-bar");
  const select = $("#replay-select");
  bar.hidden = !state.replay;
  if (state.replay) $("#replay-text").textContent = `Replaying ${state.replay.label}`;
  let custom = select.querySelector('option[data-custom]');
  if (state.replay && !select.querySelector(`option[value="${state.replay.key}"]`)) {
    if (!custom) {
      custom = document.createElement("option");
      custom.dataset.custom = "1";
      // Right after "Now", as a direct child (options[1] would be inside the optgroup).
      select.insertBefore(custom, select.children[1] || null);
    }
    custom.value = state.replay.key;
    custom.textContent = state.replay.label;
  } else if (custom && (!state.replay || custom.value !== state.replay.key)) {
    custom.remove();
  }
  select.value = state.replay ? state.replay.key : "";
}

function buildReplaySelect() {
  const select = $("#replay-select");
  select.replaceChildren();
  const now = document.createElement("option");
  now.value = "";
  now.textContent = "Selected range";
  select.appendChild(now);
  const group = document.createElement("optgroup");
  group.label = "Past S&P 500 selloffs";
  state.data.selloffs.episodes.map((e, i) => [e, i]).filter(([e]) => e.wheel).reverse().forEach(([, i]) => {
    const o = document.createElement("option");
    const v = episodeView(i);
    o.value = v.key;
    o.textContent = v.label;
    group.appendChild(o);
  });
  select.appendChild(group);
}

function viewFromKey(key) {
  if (!key) return null;
  const [kind, id] = key.split(":");
  if (kind === "ep") return state.data.selloffs.episodes[+id] ? episodeView(+id) : null;
  const dates = kind === "daily" ? state.data.series.daily.dates : (state.data.history[kind] || {}).end;
  const i = dates ? dates.indexOf(id) : -1;
  return i >= 0 ? historyView(kind, i) : null;
}

// Money flowing through the wheel: dots travel along each ribbon from source to target.
// Respects reduced motion (starts paused), can be paused, and only runs while on screen.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
state.flowPaused = reducedMotion.matches;
state.wheelVisible = true;
let flowFrame = null;
let flowParticles = [];
let flowClock = 0;

function stopFlow() {
  if (flowFrame) cancelAnimationFrame(flowFrame);
  flowFrame = null;
}

function runFlow() {
  stopFlow();
  const layer = document.querySelector("#chart-wheel .flows");
  if (layer) layer.style.display = state.flowPaused ? "none" : "";
  if (state.flowPaused || !state.wheelVisible || !flowParticles.length) return;
  const start = performance.now() - flowClock;
  const tick = (now) => {
    flowClock = now - start;
    const s = flowClock / 1000;
    for (const p of flowParticles) {
      // Quadratic Bezier through the centre, the same curve the ribbons follow.
      const u = (s / p.duration + p.phase) % 1;
      const a = (1 - u) * (1 - u);
      const b = u * u;
      p.node.setAttribute("cx", (a * p.x0 + b * p.x1).toFixed(1));
      p.node.setAttribute("cy", (a * p.y0 + b * p.y1).toFixed(1));
      p.node.setAttribute("opacity", Math.min(1, Math.sin(Math.PI * u) * 1.8).toFixed(2));
    }
    flowFrame = requestAnimationFrame(tick);
  };
  flowFrame = requestAnimationFrame(tick);
}

function setFlowPaused(paused) {
  state.flowPaused = paused;
  const btn = $("#flow-toggle");
  btn.textContent = paused ? "Play flow" : "Pause flow";
  btn.setAttribute("aria-pressed", String(paused));
  runFlow();
}

function renderWheel(t) {
  stopFlow();
  flowParticles = [];
  const view = currentView();
  const wheel = view.wheel;
  const groups = state.data.groups;
  const idx = Object.fromEntries(groups.map((g, i) => [g, i]));
  const color = (g) => groupColor(t, g);
  const matrix = groups.map(() => groups.map(() => 0));
  wheel.links.forEach((l) => { matrix[idx[l.source]][idx[l.target]] += l.value; });
  const outOf = (i) => d3.sum(matrix[i]);
  const into = (i) => d3.sum(matrix, (row) => row[i]);

  $("#wheel-headline").textContent = wheelHeadline(view);
  $("#wheel-sub").textContent = `${fmtRange(view.start, view.end)}. Real money into and out of State Street funds and stablecoins.${dollarsNote()}`;
  $("#wheel-sub").appendChild(infoButton("Where the flows come from", "flows"));

  // Side list: net per class, biggest inflow first.
  const maxAbs = d3.max(Object.values(wheel.net), Math.abs) || 1;
  const list = $("#wheel-classes");
  list.replaceChildren();
  Object.entries(wheel.net).sort((a, b) => b[1] - a[1]).forEach(([g, v]) => {
    const li = document.createElement("li");
    const key = document.createElement("span");
    key.className = "key";
    key.style.background = color(g);
    const name = document.createElement("span");
    name.textContent = g;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    const width = (Math.abs(v) / maxAbs) * 50;
    fill.style.width = `${width}%`;
    fill.style.left = v >= 0 ? "50%" : `${50 - width}%`;
    fill.style.background = v >= 0 ? t.pos : t.neg;
    bar.appendChild(fill);
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = fmtUsdBn(v, true);
    li.append(key, name, bar, num);
    list.appendChild(li);
  });

  table(cardTable("wheel"), ["From", "To", "Amount"],
    wheel.links.slice().sort((a, b) => b.value - a.value).map((l) => [l.source, l.target, fmtUsdBn(l.value)]));

  const el = document.getElementById("chart-wheel");
  el.replaceChildren();
  if (!wheel.links.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No money moved between classes in this window.";
    el.appendChild(p);
    return;
  }

  // On narrow screens the ring drops its labels; the class list beside it carries them.
  const width = el.clientWidth || 560;
  const narrow = width < 560;
  const outer = narrow ? Math.min(width / 2 - 8, 220) : Math.min(230, (width - 2 * 170) / 2);
  const inner = outer - (narrow ? 12 : 16);
  const height = outer * 2 + (narrow ? 16 : 40);

  const chords = d3.chordDirected()
    .padAngle(6 / inner)
    .sortSubgroups(d3.descending)
    .sortChords(d3.descending)(matrix);
  const arc = d3.arc().innerRadius(inner).outerRadius(outer).cornerRadius(3);
  const head = Math.min(16, inner * 0.08);
  const ribbon = d3.ribbonArrow().radius(inner - 3).padAngle(1 / inner).headRadius(head);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", [-width / 2, -height / 2, width, height])
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", `${wheelHeadline(view)}. ${fmtUsdBn(wheel.total_bn)} moved between classes in total.`);

  const ribbons = svg.append("g").selectAll("path").data(chords).join("path")
    .attr("class", "ribbon")
    .attr("d", ribbon)
    .attr("fill", (d) => color(groups[d.source.index]))
    .attr("fill-opacity", 0.62)
    .attr("stroke", t.surface)
    .attr("stroke-width", 1)
    .on("pointermove pointerdown", (ev, d) => {
      highlightRibbon(d);
      showTip(`${groups[d.source.index]} → ${groups[d.target.index]}`, [["Flow", fmtUsdBn(d.source.value)]], ev.clientX, ev.clientY);
    })
    .on("pointerleave", leave);

  // Flow dots: count proportional to each ribbon's share of the total, spread across its width.
  const budget = narrow ? 60 : 110;
  const flows = svg.append("g").attr("class", "flows").attr("pointer-events", "none");
  const flowGroups = flows.selectAll("g").data(chords).join("g");
  flowGroups.each(function (c) {
    const n = Math.max(1, Math.round((budget * c.source.value) / wheel.total_bn));
    const rs = inner - 3;
    const rt = inner - 3 - head * 0.6;
    for (let i = 0; i < n; i++) {
      const f = 0.15 + 0.7 * Math.random();
      const sa = c.source.startAngle + f * (c.source.endAngle - c.source.startAngle);
      const ta = c.target.startAngle + f * (c.target.endAngle - c.target.startAngle);
      // Neutral ink so the dots read against their own ribbon; the ribbon carries identity.
      const node = d3.select(this).append("circle")
        .attr("r", narrow ? 2.6 : 3.2)
        .attr("fill", t.text)
        .attr("fill-opacity", 0.85)
        .attr("stroke", t.surface)
        .attr("stroke-width", 1)
        .attr("opacity", 0)
        .node();
      flowParticles.push({
        node,
        x0: Math.sin(sa) * rs,
        y0: -Math.cos(sa) * rs,
        x1: Math.sin(ta) * rt,
        y1: -Math.cos(ta) * rt,
        phase: (i + Math.random() * 0.6) / n,
        duration: 2.6 + Math.random() * 0.8,
      });
    }
  });

  const arcs = svg.append("g").selectAll("g").data(chords.groups.filter((g) => g.value > 0)).join("g")
    .attr("class", "arc")
    .attr("tabindex", 0)
    .attr("aria-label", (d) => `${groups[d.index]}: ${fmtUsdBn(outOf(d.index))} out, ${fmtUsdBn(into(d.index))} in, net ${fmtUsdBn(wheel.net[groups[d.index]], true)}`);
  arcs.append("path")
    .attr("d", arc)
    .attr("fill", (d) => color(groups[d.index]))
    .attr("stroke", t.surface)
    .attr("stroke-width", 2);

  const classTip = (d, x, y) => {
    const g = groups[d.index];
    const rows = [["Net", fmtUsdBn(wheel.net[g], true)], ["Out", fmtUsdBn(outOf(d.index))], ["In", fmtUsdBn(into(d.index))]];
    groups.forEach((other, j) => {
      if (matrix[d.index][j] > 0) rows.push([`→ ${other}`, fmtUsdBn(matrix[d.index][j])]);
      if (matrix[j][d.index] > 0) rows.push([`← ${other}`, fmtUsdBn(matrix[j][d.index])]);
    });
    // Which markets inside the class drove it (the sidelines hold no markets).
    if (view.marketNets && g !== SIDELINES) {
      const movers = state.data.assets.filter((a) => a.group === g && view.marketNets[a.ticker] != null)
        .map((a) => [a.ticker, view.marketNets[a.ticker]])
        .sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 4);
      if (movers.length) movers.forEach(([tk, v], k) => rows.push([`${k ? "" : "Driven by: "}${shortName(tk)}`, fmtUsdBn(v, true)]));
    }
    showTip(g, rows, x, y);
  };
  arcs
    .on("pointermove pointerdown", (ev, d) => { highlightClass(d.index); classTip(d, ev.clientX, ev.clientY); })
    .on("pointerleave", leave)
    .on("focus", function (ev, d) {
      highlightClass(d.index);
      const box = this.getBoundingClientRect();
      classTip(d, box.left + box.width / 2, box.top + box.height / 2);
    })
    .on("blur", () => { reset(); hideTip(); });

  function highlightClass(i) {
    ribbons.attr("fill-opacity", (c) => (c.source.index === i || c.target.index === i ? 0.85 : 0.06));
    flowGroups.attr("opacity", (c) => (c.source.index === i || c.target.index === i ? 1 : 0.08));
    arcs.attr("opacity", (g) => (g.index === i || matrix[i][g.index] || matrix[g.index][i] ? 1 : 0.35));
  }
  function highlightRibbon(d) {
    ribbons.attr("fill-opacity", (c) => (c === d ? 0.9 : 0.06));
    flowGroups.attr("opacity", (c) => (c === d ? 1 : 0.08));
    arcs.attr("opacity", (g) => (g.index === d.source.index || g.index === d.target.index ? 1 : 0.35));
  }
  function reset() {
    ribbons.attr("fill-opacity", 0.62);
    flowGroups.attr("opacity", 1);
    arcs.attr("opacity", 1);
  }
  // A tap ends with pointerleave straight away; keep touch details up until the next tap elsewhere.
  function leave(ev) {
    if (ev.pointerType === "touch") return;
    reset();
    hideTip();
  }
  state.wheelReset = () => { reset(); hideTip(); };

  // Class labels outside the ring: name, then net in/out. Labels sit left or right of
  // the ring and are pushed apart vertically so small neighbouring arcs stay readable.
  const lineHeight = 36;
  const labelData = narrow ? [] : chords.groups.filter((g) => g.value > 0).map((d) => {
    const a = (d.startAngle + d.endAngle) / 2;
    const side = Math.sin(a) >= 0 ? 1 : -1;
    // Columns either side of the ring, so labels never sit on top of it.
    return { d, a, side, x: side * (outer + 28), y: -Math.cos(a) * (outer + 8) - lineHeight / 2 + 6 };
  });
  [1, -1].forEach((side) => {
    const items = labelData.filter((l) => l.side === side).sort((p, q) => p.y - q.y);
    const top = -height / 2 + 12;
    for (let i = 0; i < items.length; i++) items[i].y = Math.max(items[i].y, i ? items[i - 1].y + lineHeight : top);
    const bottom = height / 2 - lineHeight + 8;
    for (let i = items.length - 1; i >= 0; i--) {
      const limit = i === items.length - 1 ? bottom : items[i + 1].y - lineHeight;
      items[i].y = Math.min(items[i].y, limit);
    }
  });

  const leaders = svg.append("g").attr("pointer-events", "none");
  leaders.selectAll("path").data(labelData).join("path")
    .attr("d", (l) => {
      const r0 = outer + 3;
      const x0 = Math.sin(l.a) * r0;
      const y0 = -Math.cos(l.a) * r0;
      const yl = l.y + lineHeight / 2 - 10;
      return `M${x0},${y0}L${l.x - l.side * 4},${yl}`;
    })
    .attr("stroke", t.axis)
    .attr("fill", "none");

  const labels = svg.append("g").attr("pointer-events", "none").selectAll("text")
    .data(labelData).join("text")
    .attr("transform", (l) => `translate(${l.x},${l.y})`)
    .attr("text-anchor", (l) => (l.side > 0 ? "start" : "end"));
  labels.append("tspan")
    .attr("x", 0)
    .attr("fill", t.text)
    .attr("font-size", narrow ? 12 : 13)
    .attr("font-weight", 600)
    .text((l) => groups[l.d.index]);
  labels.append("tspan")
    .attr("x", 0)
    .attr("dy", "1.3em")
    .attr("fill", t.text2)
    .attr("font-size", narrow ? 11 : 12)
    .text((l) => {
      const v = wheel.net[groups[l.d.index]];
      return `${fmtUsdBn(v, true)} ${v >= 0 ? "in" : "out"}`;
    });

  // Hub: the total that moved, haloed so it reads on top of the ribbons.
  runFlow();

  const hub = svg.append("g")
    .attr("pointer-events", "none")
    .attr("text-anchor", "middle")
    .attr("stroke", t.surface)
    .attr("stroke-width", narrow ? 4 : 6)
    .attr("stroke-linejoin", "round")
    .attr("paint-order", "stroke");
  hub.append("text")
    .attr("y", -4)
    .attr("fill", t.text)
    .attr("font-size", narrow ? 24 : 32)
    .attr("font-weight", 600)
    .text(fmtUsdBn(wheel.total_bn));
  hub.append("text")
    .attr("y", narrow ? 16 : 20)
    .attr("fill", t.text)
    .attr("font-size", narrow ? 11 : 13)
    .text(view.hub);
}

// ---------- rotation map ----------

function renderSankey(t) {
  const w = aggregate();
  const sk = allocateFlows(Object.fromEntries(Object.entries(w.assets).map(([k, a]) => [k, a.net_flow_bn])));
  $("#sankey-sub").textContent =
    `${fmtRange(w.start, w.end)}. ${fmtUsdBn(sk.total_out_bn)} pulled out of funds, ${fmtUsdBn(sk.total_in_bn)} put in.${dollarsNote()}`;
  const ids = new Set();
  sk.links.forEach((l) => { ids.add(l.source); ids.add(l.target); });
  const nodeTotals = {};
  sk.links.forEach((l) => {
    nodeTotals[l.source] = (nodeTotals[l.source] || 0) + l.value;
    nodeTotals[l.target] = (nodeTotals[l.target] || 0) + l.value;
  });
  const sources = new Set(sk.links.map((l) => l.source));
  const c = chart("chart-sankey");
  const narrow = document.getElementById("chart-sankey").clientWidth < 560;
  c.clear();
  if (!sk.links.length) {
    c.setOption({ title: { text: "No net flows in this window", left: "center", top: "middle", textStyle: { color: t.muted, fontSize: 13, fontWeight: 400 } } });
  } else {
    c.setOption({
      tooltip: {
        ...tooltipBase(t),
        trigger: "item",
        formatter: (p) => {
          if (p.dataType === "edge") {
            return `<div style="margin-bottom:4px">${esc(assetName(p.data.source))} → ${esc(assetName(p.data.target))}</div>` +
              row("Allocated flow", fmtUsdBn(p.data.value));
          }
          const out = sources.has(p.name);
          return `<div style="margin-bottom:4px">${esc(assetName(p.name))}</div>` +
            row(out ? "Net selling" : "Net buying", fmtUsdBn(nodeTotals[p.name]));
        },
      },
      series: [{
        type: "sankey",
        left: narrow ? 92 : 150,
        right: narrow ? 92 : 150,
        top: 8,
        bottom: 8,
        nodeWidth: 10,
        nodeGap: 8,
        draggable: false,
        layoutIterations: 64,
        emphasis: { focus: "adjacency" },
        levels: [
          { depth: 0, label: { position: "left" } },
          { depth: 1, label: { position: "right" } },
        ],
        label: {
          color: t.text,
          fontSize: narrow ? 11 : 12,
          width: narrow ? 84 : undefined,
          overflow: "truncate",
          formatter: (p) => (narrow ? shortName(p.name) : `${shortName(p.name)}  {v|${fmtUsdBn(nodeTotals[p.name])}}`),
          rich: { v: { color: t.text2, fontSize: 11 } },
        },
        labelLayout: { hideOverlap: true },
        itemStyle: { borderWidth: 0 },
        lineStyle: { color: "source", opacity: 0.28, curveness: 0.5 },
        data: [...ids].map((id) => ({ name: id, itemStyle: { color: assetColor(id, t) } })),
        links: sk.links.map((l) => ({ ...l })),
      }],
    }, true);
  }
  c.off("click");
  c.on("click", (p) => { if (p.dataType === "node" && p.name !== SIDELINES) openCloseup(p.name); });
  table(cardTable("sankey"), ["From", "To", "Allocated flow"],
    sk.links.slice().sort((a, b) => b.value - a.value)
      .map((l) => [assetName(l.source), assetName(l.target), fmtUsdBn(l.value)]));
}

// Horizontal bar value axis: padded so end labels have room, with a tick step chosen
// from the data so phones get three or four ticks instead of a crowded row.
function barValueAxis(t, values) {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const target = narrowScreen() ? 3 : 5;
  const raw = (hi - lo) / target || 0.01;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw);
  // Room for the value labels, with both ends on a tick so every label is a round number.
  const pad = (hi - lo) * 0.12;
  const digits = Math.abs(Math.round(step * 100) - step * 100) > 1e-9 ? 1 : 0;
  return {
    type: "value",
    min: lo < 0 ? Math.floor((lo - pad) / step) * step : 0,
    max: hi > 0 ? Math.ceil((hi + pad) / step) * step : 0,
    interval: step,
    ...axisStyle(t),
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => fmtPct(v, digits) },
  };
}

// Bar value labels: outside the bar end, except long negative bars, where the label sits
// inside the bar (white on the fill) so it can't run into the category names.
function barLabel(t, values, digits) {
  const maxAbs = Math.max(...values.map(Math.abs)) || 1;
  return (v) => {
    const inside = v < 0 && Math.abs(v) / maxAbs > 0.45;
    return {
      show: true,
      position: inside ? "insideLeft" : v < 0 ? "left" : "right",
      color: inside ? "#ffffff" : t.text2,
      fontSize: 11,
      formatter: () => fmtPct(v, digits),
    };
  };
}

function barGrid() {
  return { left: 8, right: 48, top: 8, bottom: 28, containLabel: true };
}

function barCategoryName(ticker) {
  return narrowScreen() ? shortName(ticker) : assetName(ticker);
}

function renderIntensity(t) {
  const sub = $("#intensity-sub");
  if (!sub.querySelector("button")) sub.appendChild(infoButton("Flow as a share of each fund", "intensity"));
  const w = aggregate();
  const rows = Object.entries(w.assets)
    .filter(([, v]) => v.intensity != null)
    .sort((a, b) => a[1].intensity - b[1].intensity);
  const vals = rows.map(([, v]) => v.intensity);
  const intensityLabel = barLabel(t, vals, 1);
  const c = chart("chart-intensity");
  c.setOption({
    grid: barGrid(),
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p) => {
        const v = w.assets[rows[p.dataIndex][0]];
        return `<div style="margin-bottom:4px">${esc(assetName(rows[p.dataIndex][0]))}</div>` +
          row("Net flow, share of fund", fmtPct(v.intensity)) +
          row("Net flow", fmtUsdBn(v.net_flow_bn, true)) +
          row("Fund size at start", fmtUsdBn(v.aum_bn)) +
          row("Return", fmtPct(v.ret));
      },
    },
    xAxis: barValueAxis(t, vals),
    yAxis: {
      type: "category",
      data: rows.map(([k]) => barCategoryName(k)),
      ...axisStyle(t),
      axisLabel: { color: t.text2, fontSize: 12 },
      splitLine: { show: false },
    },
    series: [{
      type: "bar",
      barWidth: "60%",
      data: rows.map(([, v]) => ({
        value: v.intensity,
        label: intensityLabel(v.intensity),
        itemStyle: {
          color: v.intensity >= 0 ? t.pos : t.neg,
          borderRadius: v.intensity >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
        },
      })),
    }],
  }, true);
  c.off("click");
  c.on("click", (p) => openCloseup(rows[p.dataIndex][0]));
  table(cardTable("intensity"), ["Market", "Share of fund", "Net flow", "Fund size", "Return"],
    rows.slice().reverse().map(([k, v]) => [
      assetName(k), fmtPct(v.intensity), fmtUsdBn(v.net_flow_bn, true), fmtUsdBn(v.aum_bn), fmtPct(v.ret),
    ]));
}

// ---------- liquidity history ----------

state.history = { kind: "weekly", mode: "flows" };

// Which grains the selected range supports, and a sensible default for it.
function grainAvailable(kind) {
  const b = rangeBounds();
  if (kind === "daily") return b.start >= state.data.series.daily.dates[0];
  // Weekly history covers three years; allow a few days of slack so the 3Y preset fits.
  if (kind === "weekly") return b.start >= shiftDate(state.data.history.weekly.start[0], -10);
  return true;
}

function autoGrain() {
  const days = rangeDays();
  if (days <= 45 && grainAvailable("daily")) return "daily";
  if (days <= 3 * 366 && grainAvailable("weekly")) return "weekly";
  return "monthly";
}

// Net flow per class for each period of the chosen grain inside the range.
function historyData(kind) {
  const groups = state.data.groups;
  const idx = periodsInRange(kind);
  const out = { idx, start: [], end: [], net: Object.fromEntries(groups.map((g) => [g, []])), total: [] };
  if (kind === "daily") {
    idx.forEach((i) => {
      const p = periodAt("daily", i);
      out.start.push(p.start);
      out.end.push(p.end);
      groups.forEach((g) => out.net[g].push(p.wheel.net[g]));
      out.total.push(p.wheel.total_bn);
    });
  } else {
    const h = state.data.history[kind];
    idx.forEach((i) => {
      const k = deflator(h.end[i]);
      out.start.push(h.start[i]);
      out.end.push(h.end[i]);
      groups.forEach((g) => out.net[g].push(h.net[g][i] * k));
      out.total.push(h.total[i] * k);
    });
  }
  return out;
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderHistory(t) {
  if (!grainAvailable(state.history.kind)) state.history.kind = autoGrain();
  const { kind, mode } = state.history;
  const h = historyData(kind);
  const groups = state.data.groups;
  const color = (g) => groupColor(t, g);
  document.querySelectorAll("#history-kind button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.kind === kind));
    b.disabled = !grainAvailable(b.dataset.kind);
  });
  document.querySelectorAll("#history-mode button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));

  const c = chart("chart-history");
  if (!h.end.length) {
    c.clear();
    $("#history-headline").textContent = "No flow history in this range";
    $("#history-sub").textContent = "Flow history starts in January 2017. Pick a later or longer range.";
    table(cardTable("history"), ["Period"], []);
    return;
  }
  const totals = Object.fromEntries(groups.map((g) => [g, d3.sum(h.net[g])]));
  const ranked = Object.entries(totals).filter(([g]) => g !== SIDELINES).sort((a, b) => b[1] - a[1]);
  const [topIn, topOut] = [ranked[0], ranked[ranked.length - 1]];
  const span = fmtRange(h.start[0], h.end[h.end.length - 1]);
  const lead = state.range.preset === "ALL" ? `Since ${fmtMonth(h.start[0])}` : capitalise(rangeSpan());
  // The sidelines' total is the net new money: negative means money came in from outside.
  const fresh = -(totals[SIDELINES] || 0);
  const net = Math.abs(fresh) < 0.05 ? "" : fresh > 0 ? `; ${fmtUsdBn(fresh)} of new money came in overall` : `; ${fmtUsdBn(-fresh)} left the tracked funds overall`;
  $("#history-headline").textContent = topIn[1] > 0 && topOut[1] < 0
    ? `${lead}, the most money flowed into ${topIn[0]} (${fmtUsdBn(topIn[1], true)}) and out of ${topOut[0]} (${fmtUsdBn(topOut[1], true)})${net}`
    : `${lead}, the most money flowed into ${topIn[0]} (${fmtUsdBn(topIn[1], true)})${net}`;
  const unit = { daily: "day", weekly: "week", monthly: "month" }[kind];
  $("#history-sub").textContent = mode === "flows"
    ? `Net flow per ${unit}, ${span}. Bars above zero are money coming in, below zero money going out. Shaded bands are S&P 500 selloffs.${dollarsNote()}`
    : `Running total of net flows, ${span}. A rising line means a class keeps attracting money. Shaded bands are S&P 500 selloffs.${dollarsNote()}`;

  const running = (arr) => { let acc = 0; return arr.map((v) => (acc += v)); };
  // The sidelines would only mirror every other bar, so they show as one line instead:
  // net new money into the tracked funds (their balance with the sign flipped).
  const NEW_MONEY = "Net new money";
  const series = groups.map((g, gi) => {
    if (g === SIDELINES) {
      const fresh = h.net[g].map((v) => -v);
      const values = mode === "flows" ? fresh : running(fresh);
      return {
        name: NEW_MONEY, type: "line", z: 5, showSymbol: mode === "flows" && h.end.length <= 60, symbolSize: 4,
        data: h.end.map((d, i) => [d, Math.round(values[i] * 100) / 100]),
        lineStyle: { width: 1.5, color: t.text2, type: mode === "flows" ? "dashed" : "solid" },
        itemStyle: { color: t.text2 },
        emphasis: { focus: "series" },
        endLabel: mode === "flows" ? undefined : { show: !narrowScreen(), formatter: "{a}", color: t.text2, fontSize: 11 },
        labelLayout: { moveOverlap: "shiftY" },
      };
    }
    const values = mode === "flows" ? h.net[g] : running(h.net[g]);
    const base = {
      name: g,
      data: h.end.map((d, i) => [d, Math.round(values[i] * 100) / 100]),
      itemStyle: { color: color(g) },
      emphasis: { focus: "series" },
      markArea: gi === 0 ? selloffBands(t) : undefined,
    };
    return mode === "flows"
      ? { ...base, type: "bar", stack: "net", barMaxWidth: 14, itemStyle: { color: color(g), borderColor: t.surface, borderWidth: 0.5 } }
      : { ...base, type: "line", showSymbol: false, lineStyle: { width: 2, color: color(g) },
          endLabel: { show: !narrowScreen(), formatter: "{a}", color: t.text2, fontSize: 11 }, labelLayout: { moveOverlap: "shiftY" } };
  });

  c.setOption({
    grid: { left: 8, right: mode === "cumulative" && !narrowScreen() ? 130 : 16, top: narrowScreen() ? 64 : 40, bottom: 24, containLabel: true },
    legend: {
      top: 0, left: 0, textStyle: { color: t.text2, fontSize: 12 }, inactiveColor: t.grid,
      icon: mode === "flows" ? "roundRect" : "path://M0,0 L12,0 L12,2 L0,2 Z", itemWidth: 12, itemHeight: mode === "flows" ? 10 : 2,
    },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: mode === "flows" ? "shadow" : "line", lineStyle: { color: t.axis } },
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        const head = `<div style="margin-bottom:4px">${esc(fmtRange(h.start[i], h.end[i]))}</div>`;
        const rows = ps.slice().sort((a, b) => b.data[1] - a.data[1]).map((p) => row(p.seriesName, fmtUsdBn(p.data[1], true), p.color)).join("");
        const foot = mode === "flows" ? row("Total moved", fmtUsdBn(h.total[i])) : "";
        return head + rows + foot + `<div style="margin-top:6px;opacity:.7">Click to replay in the wheel</div>`;
      },
    },
    xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true } },
    yAxis: { type: "value", ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: fmtAxisUsd } },
    series,
  }, true);
  c.off("click");
  c.on("click", (p) => replay(historyView(kind, h.idx[p.dataIndex])));
  // Clicking anywhere in a column (not only on a bar segment) replays that period too.
  c.getZr().off("click");
  c.getZr().on("click", (ev) => {
    if (ev.target) return;
    const pt = [ev.offsetX, ev.offsetY];
    if (!c.containPixel("grid", pt)) return;
    const x = c.convertFromPixel({ seriesIndex: 0 }, pt)[0];
    const ends = h.end.map((d) => parseDay(d).getTime());
    let best = 0;
    ends.forEach((e, i) => { if (Math.abs(e - x) < Math.abs(ends[best] - x)) best = i; });
    replay(historyView(kind, h.idx[best]));
  });

  const classes = groups.filter((g) => g !== SIDELINES);
  table(cardTable("history"), ["Period", ...classes, "Net new money", "Total moved"],
    h.end.map((d, i) => [fmtRange(h.start[i], d), ...classes.map((g) => fmtUsdBn(h.net[g][i], true)),
      fmtUsdBn(-(h.net[SIDELINES] || [])[i] || 0, true), fmtUsdBn(h.total[i])]).reverse());
}

// ---------- market close-up ----------

state.market = "SPY";

function buildCloseupSelect() {
  const select = $("#closeup-select");
  select.replaceChildren();
  state.data.groups.forEach((g) => {
    const og = document.createElement("optgroup");
    og.label = g;
    state.data.assets.filter((a) => a.group === g).forEach((a) => {
      const o = document.createElement("option");
      o.value = a.ticker;
      o.textContent = a.name;
      og.appendChild(o);
    });
    if (og.children.length) select.appendChild(og);
  });
}

function openCloseup(ticker, scroll = true) {
  if (!state.assets[ticker]) return;
  state.market = ticker;
  safely("market close-up", renderCloseup, theme());
  writeHash();
  if (scroll) $("#closeup").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCloseup(t) {
  const d = state.data;
  const mw = d.markets_weekly;
  const tk = state.market;
  const name = assetName(tk);
  $("#closeup-select").value = tk;
  $("#closeup-title").textContent = `Market close-up: ${name}`;

  // Stats row: the selected range first, then fixed history.
  const m = aggregate().assets[tk] || {};
  const st = (d.streaks.assets || {})[tk];
  const pb = d.selloffs.playbook.find((r) => r.ticker === tk);
  const stats = [
    [`Range: ${rangeShort()}`, fmtPct(m.ret), m.net_flow_bn != null
      ? `Net flow ${fmtUsdBn(m.net_flow_bn, true)}${m.intensity != null ? ` (${fmtPct(m.intensity, 1)} of the fund)` : ""}`
      : "Price only: no SPDR fund to measure flows"],
    st ? ["Last 8 weeks", fmtUsdBn(st.total_bn, true), `Inflows in ${st.inflow_weeks} of ${st.weeks} weeks`] : null,
    pb && tk !== d.meta.benchmark ? ["In selloffs since 2016", `rose ${Math.round(pb.hit_rate * pb.episodes)} of ${pb.episodes}`, `Median move ${fmtPct(pb.median_ret)}`] : null,
    pb && pb.median_rebound != null && tk !== d.meta.benchmark ? ["After the bottom", fmtPct(pb.median_rebound), `Median over the next ${d.selloffs.rebound_days} trading days`] : null,
  ].filter(Boolean);
  const ul = $("#closeup-stats");
  ul.replaceChildren();
  stats.forEach(([k, v, dd]) => {
    const li = document.createElement("li");
    [["k", k], ["v", v], ["d", dd]].forEach(([cls, txt]) => {
      const sp = document.createElement("span");
      sp.className = cls;
      sp.textContent = txt;
      li.appendChild(sp);
    });
    ul.appendChild(li);
  });

  // Points for the range: daily up to about six months, weekly up to three years, else monthly.
  const b = rangeBounds();
  const D = d.series.daily;
  const M = d.series.monthly;
  let pts;
  if (b.start >= D.dates[0] && rangeDays(b) <= 200) {
    pts = { unit: "day", label: "Daily net flow", idx: D.dates.map((x, i) => (inRange(x, b) ? i : -1)).filter((i) => i >= 0), end: D.dates, close: D.close[tk], flow: D.flow[tk] };
  } else if (mw && b.start >= shiftDate(mw.end[0], -10)) {
    pts = { unit: "week", label: "Weekly net flow", idx: mw.end.map((x, i) => (inRange(x, b) ? i : -1)).filter((i) => i >= 0), end: mw.end, close: mw.close[tk], flow: mw.net[tk] };
  } else {
    pts = { unit: "month", label: "Monthly net flow", idx: M.end.map((x, i) => (overlapsRange(M.start[i], x, b) ? i : -1)).filter((i) => i >= 0), end: M.end, close: M.close[tk], flow: M.flow[tk] };
  }
  const ends = pts.idx.map((i) => pts.end[i]);
  const closes = pts.idx.map((i) => realPrice(pts.close[i], pts.end[i]));
  const base = closes.find((v) => v != null);
  const price = ends.map((e, i) => [e, closes[i] == null || !base ? null : Math.round((closes[i] / base) * 1000) / 10]);
  const hasFlow = state.assets[tk].flows;
  const fl = pts.flow || [];
  const flows = ends.map((e, i) => [e, fl[pts.idx[i]] == null ? null : fl[pts.idx[i]] * deflator(e)]);
  const priceName = tk === "STABLES" ? "Supply, indexed to 100" : state.real ? "Real price, indexed to 100" : "Price, indexed to 100";
  const narrow = narrowScreen();
  const c = chart("chart-closeup");
  c.setOption({
    axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: t.axis } },
    grid: [
      { left: 8, right: 16, top: 30, height: "44%", containLabel: true },
      { left: 8, right: 16, top: "62%", bottom: 24, containLabel: true },
    ],
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        const when = pts.unit === "day" ? fmtDate(ends[i]) : pts.unit === "week" ? `Week ending ${fmtDate(ends[i])}` : fmtMonth(ends[i]);
        return `<div style="margin-bottom:4px">${esc(when)}</div>` +
          row(tk === "STABLES" ? "Supply (indexed)" : "Price (indexed)", price[i][1] == null ? "–" : price[i][1].toFixed(1), assetColor(tk, t)) +
          (hasFlow ? row(`Net flow that ${pts.unit}`, fmtUsdBn(flows[i][1], true)) : "");
      },
    },
    xAxis: [
      { type: "time", gridIndex: 0, ...axisStyle(t), axisLabel: { show: false }, splitLine: { show: false } },
      { type: "time", gridIndex: 1, ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, name: priceName, nameGap: 12, nameTextStyle: { color: t.muted, fontSize: 11, align: "left" }, ...axisStyle(t), axisLine: { show: false }, splitNumber: narrow ? 3 : 4 },
      { type: "value", gridIndex: 1, name: hasFlow ? pts.label : "No flow data: price only", nameGap: 12, nameTextStyle: { color: t.muted, fontSize: 11, align: "left" }, ...axisStyle(t), axisLine: { show: false }, splitNumber: 3, axisLabel: { color: t.muted, fontSize: 11, formatter: fmtAxisUsd } },
    ],
    series: [
      {
        type: "line", xAxisIndex: 0, yAxisIndex: 0, data: price, showSymbol: false, connectNulls: true,
        lineStyle: { width: 2, color: assetColor(tk, t) },
        itemStyle: { color: assetColor(tk, t) },
        markArea: selloffBands(t),
      },
      {
        type: "bar", xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: pts.unit === "day" && ends.length < 40 ? 14 : 8,
        data: flows.map(([e, v]) => ({ value: [e, v], itemStyle: { color: v >= 0 ? t.pos : t.neg } })),
        markArea: selloffBands(t),
      },
    ],
  }, true);
  table(cardTable("closeup"), [pts.unit === "month" ? "Month" : pts.unit === "week" ? "Week ending" : "Day", "Price (indexed)", "Net flow"],
    ends.map((e, i) => [pts.unit === "month" ? fmtMonth(e) : fmtDate(e), price[i][1] == null ? "–" : price[i][1].toFixed(1), fmtUsdBn(flows[i][1], true)]).reverse());
}

// ---------- selloffs ----------

// Selloffs that overlap the selected range.
function selloffsInRange() {
  const b = rangeBounds();
  return state.data.selloffs.episodes.filter((e) => overlapsRange(e.peak, e.trough, b)).map(realEpisode);
}

// Selloffs to show: those in the range, or every selloff when the range holds no completed
// one, so the playbook never goes blank on short ranges.
function selloffsShown() {
  const inRange = selloffsInRange();
  if (inRange.some((e) => !e.ongoing)) return { eps: inRange, all: false };
  return { eps: state.data.selloffs.episodes.map(realEpisode), all: true };
}

// Port of pipeline/analytics.py playbook(): how each market behaved across completed selloffs.
function computePlaybook(eps) {
  const done = eps.filter((e) => !e.ongoing);
  return pricedAssets().map(({ ticker }) => {
    const pick = (k) => done.map((e) => e.assets[ticker] && e.assets[ticker][k]).filter((v) => v != null);
    const rets = pick("ret");
    if (!rets.length) return null;
    return {
      ticker,
      episodes: rets.length,
      median_ret: median(rets),
      hit_rate: rets.filter((x) => x > 0).length / rets.length,
      median_rebound: median(pick("rebound")),
      median_volume_ratio: median(pick("volume_ratio")),
    };
  }).filter(Boolean).sort((a, b) => b.median_ret - a.median_ret);
}

function emptyChart(c, t, text) {
  c.clear();
  c.setOption({ title: { text, left: "center", top: "middle", textStyle: { color: t.muted, fontSize: 13, fontWeight: 400, width: 260, overflow: "break" } } });
}

function renderPlaybook(t) {
  const s = state.data.selloffs;
  const pct = `${Math.round(s.threshold * 100)}%`;
  const shown = selloffsShown();
  const done = shown.eps.filter((e) => !e.ongoing).length;
  $("#selloff-sub").textContent = shown.all
    ? `No completed S&P 500 selloff of ${pct} or more ${rangeSpan()}, so these charts show all ${done} since ${fmtMonth(shown.eps[0].peak)}. What rose while stocks fell is where sellers' money went.`
    : `${done} completed S&P 500 selloff${done === 1 ? "" : "s"} of ${pct} or more ${rangeSpan()}. What rose while stocks fell is where sellers' money went.`;
  $("#threshold-text").textContent = pct;
  const playbook = computePlaybook(shown.eps);
  const rows = playbook.slice().reverse();
  const vals = rows.map((r) => r.median_ret);
  const playbookLabel = barLabel(t, vals, 1);
  const c = chart("chart-playbook");
  if (!rows.length) {
    emptyChart(c, t, "No completed selloffs in this range");
    table(cardTable("playbook"), ["Market"], []);
    return;
  }
  c.setOption({
    grid: barGrid(),
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p) => {
        const r = rows[p.dataIndex];
        return `<div style="margin-bottom:4px">${esc(assetName(r.ticker))}</div>` +
          row("Median selloff return", fmtPct(r.median_ret)) +
          row("Rose in", `${Math.round(r.hit_rate * r.episodes)} of ${r.episodes} selloffs`) +
          row(`Next ${s.rebound_days} days`, fmtPct(r.median_rebound)) +
          row("Volume vs normal", `${fmtNum(r.median_volume_ratio, 2)}×`);
      },
    },
    xAxis: barValueAxis(t, vals),
    yAxis: {
      type: "category",
      data: rows.map((r) => barCategoryName(r.ticker)),
      ...axisStyle(t),
      axisLabel: { color: t.text2, fontSize: 12 },
      splitLine: { show: false },
    },
    series: [{
      type: "bar",
      barWidth: "60%",
      data: rows.map((r) => ({
        value: r.median_ret,
        label: playbookLabel(r.median_ret),
        itemStyle: { color: r.median_ret >= 0 ? t.pos : t.neg, borderRadius: r.median_ret >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
      })),
    }],
  }, true);
  c.off("click");
  c.on("click", (p) => openCloseup(rows[p.dataIndex].ticker));
  table(cardTable("playbook"), ["Market", "Median return", "Rose in", `Next ${s.rebound_days}d`, "Volume vs normal"],
    playbook.map((r) => [
      assetName(r.ticker), fmtPct(r.median_ret), `${Math.round(r.hit_rate * r.episodes)}/${r.episodes}`,
      fmtPct(r.median_rebound), `${fmtNum(r.median_volume_ratio, 2)}×`,
    ]));
}

function renderHeatmap(t) {
  const s = state.data.selloffs;
  const eps = selloffsShown().eps.slice().reverse();
  const tickers = (computePlaybook(eps.length ? eps : s.episodes)).map((r) => r.ticker);
  const el = document.getElementById("chart-heatmap");
  if (!eps.length) {
    el.style.height = "240px";
    const c0 = chart("chart-heatmap");
    c0.resize();
    emptyChart(c0, t, "No selloffs in this range");
    table(cardTable("heatmap"), ["Selloff"], []);
    return;
  }
  el.style.height = `${Math.max(240, eps.length * 24 + 110)}px`;
  const data = [];
  eps.forEach((e, y) => tickers.forEach((tk, x) => {
    const v = e.assets[tk] ? e.assets[tk].ret : null;
    data.push([x, y, v == null ? "-" : v]);
  }));
  const label = (e) => `${fmtMonth(e.peak)}  ${fmtPct(e.drawdown, 0)}${e.ongoing ? " · now" : ""}`;
  const c = chart("chart-heatmap");
  c.resize();
  c.setOption({
    grid: { left: 110, right: 8, top: 8, bottom: 84 },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p) => {
        const e = eps[p.data[1]];
        const tk = tickers[p.data[0]];
        const a = e.assets[tk];
        if (!a || a.ret == null) return `${esc(assetName(tk))}: no data`;
        return `<div style="margin-bottom:4px">${esc(assetName(tk))} · ${esc(fmtRange(e.peak, e.trough))}${e.ongoing ? " (ongoing)" : ""}</div>` +
          row("Return", fmtPct(a.ret)) +
          row("S&P 500", fmtPct(e.drawdown)) +
          (a.net_flow_bn != null ? row("Net flow", fmtUsdBn(a.net_flow_bn, true)) : "") +
          row("Volume vs normal", `${fmtNum(a.volume_ratio, 2)}×`) +
          row(`Next ${s.rebound_days} days`, fmtPct(a.rebound));
      },
    },
    xAxis: {
      type: "category",
      data: tickers.map(shortName),
      ...axisStyle(t),
      axisLine: { show: false },
      axisLabel: { color: t.text2, fontSize: narrowScreen() ? 10 : 11, rotate: narrowScreen() ? 90 : 45, interval: 0 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: eps.map(label),
      inverse: true,
      ...axisStyle(t),
      axisLine: { show: false },
      axisLabel: { color: t.text2, fontSize: 11 },
      splitLine: { show: false },
    },
    visualMap: {
      type: "continuous",
      min: -0.25,
      max: 0.25,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 180,
      text: ["+25%", `${MINUS}25%`],
      textStyle: { color: t.muted, fontSize: 11 },
      inRange: { color: [t.neg, t.mid, t.pos] },
    },
    series: [{
      type: "heatmap",
      data,
      itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } },
    }],
  }, true);
  c.off("click");
  c.on("click", (p) => {
    const e = eps[p.data[1]];
    const i = state.data.selloffs.episodes.indexOf(e._src || e);
    if (state.data.selloffs.episodes[i].wheel) replay(episodeView(i));
  });
  const cashKeys = [["stablecoins", "Stablecoins"], ["retail_mmf", "Retail MMF"], ["rrp", "Reverse repo"], ["net_liquidity", "Net liquidity"]];
  table(cardTable("heatmap"),
    ["Selloff", "S&P 500", ...tickers.filter((tk) => tk !== "SPY").map(shortName), ...cashKeys.map((c) => `Δ ${c[1]}`)],
    eps.map((e) => [
      `${fmtRange(e.peak, e.trough)}${e.ongoing ? " (ongoing)" : ""}`,
      fmtPct(e.drawdown),
      ...tickers.filter((tk) => tk !== "SPY").map((tk) => fmtPct(e.assets[tk] && e.assets[tk].ret)),
      ...cashKeys.map(([k]) => fmtUsdBn(e.cash[k], true)),
    ]));
}

// ---------- outlook: historically grounded signals ----------

function outlookCard(title, lede) {
  const card = document.createElement("article");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = title;
  const p = document.createElement("p");
  p.className = "lede";
  p.textContent = lede;
  card.append(h, p);
  return card;
}

function outlookList(card, rows, heading) {
  if (heading) {
    const h = document.createElement("h4");
    h.textContent = heading;
    card.appendChild(h);
  }
  const ul = document.createElement("ul");
  ul.className = "olist";
  rows.forEach((r) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.name;
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = r.value;
    li.append(name, val);
    if (r.meter != null) {
      const m = document.createElement("div");
      m.className = "meter";
      const f = document.createElement("span");
      f.style.width = `${Math.round(Math.max(0, Math.min(1, r.meter)) * 100)}%`;
      m.appendChild(f);
      li.appendChild(m);
    }
    if (r.why) {
      const w = document.createElement("span");
      w.className = "why";
      w.textContent = r.why;
      li.appendChild(w);
    }
    ul.appendChild(li);
  });
  card.appendChild(ul);
}

function renderOutlook() {
  const d = state.data;
  const grid = $("#outlook-grid");
  grid.replaceChildren();
  const pb = d.selloffs.playbook;
  const n = pb.length ? pb[0].episodes : 0;

  // 1. If stocks sell off next: the markets that most reliably held up.
  const havens = pb.slice().sort((a, b) => b.hit_rate - a.hit_rate || b.median_ret - a.median_ret).slice(0, 4);
  const hurt = pb.slice().sort((a, b) => a.median_ret - b.median_ret).slice(0, 3);
  const c1 = outlookCard("If stocks sell off next", `In the ${n} S&P 500 selloffs since 2016, these markets most often held up, and these were hit hardest.`);
  outlookList(c1, havens.map((r) => ({
    name: assetName(r.ticker),
    value: `rose ${Math.round(r.hit_rate * r.episodes)} of ${r.episodes}`,
    meter: r.hit_rate,
    why: `Median move during a selloff ${fmtPct(r.median_ret)}`,
  })), "Usually held up");
  outlookList(c1, hurt.map((r) => ({ name: assetName(r.ticker), value: fmtPct(r.median_ret), why: `Typical fall while the S&P 500 dropped ${fmtPct(median(d.selloffs.episodes.filter((e) => !e.ongoing).map((e) => e.drawdown)), 0)}` })), "Hit hardest");
  grid.appendChild(c1);

  // 2. After the bottom: who bounced back fastest.
  const rebound = pb.filter((r) => r.median_rebound != null).sort((a, b) => b.median_rebound - a.median_rebound).slice(0, 5);
  const c2 = outlookCard("After the bottom", `Once a selloff ended, these markets bounced back fastest over the next ${d.selloffs.rebound_days} trading days (median).`);
  outlookList(c2, rebound.map((r) => ({ name: assetName(r.ticker), value: fmtPct(r.median_rebound), why: `After falling a median ${fmtPct(r.median_ret)} in the selloff` })));
  grid.appendChild(c2);

  // 3. Momentum: where money has been building or leaving over the last 8 weeks.
  const sa = Object.entries(d.streaks.assets);
  const building = sa.filter(([, v]) => v.total_bn > 0).sort((a, b) => b[1].total_bn - a[1].total_bn).slice(0, 3);
  const leaving = sa.filter(([, v]) => v.total_bn < 0).sort((a, b) => a[1].total_bn - b[1].total_bn).slice(0, 3);
  const streakWhy = (v) => {
    const buying = v.total_bn > 0;
    const faster = buying ? v.recent_bn > v.prior_bn : v.recent_bn < v.prior_bn;
    const pace = buying ? (faster ? "buying picking up" : "buying slowing") : (faster ? "selling picking up" : "selling easing");
    return `Inflows in ${v.inflow_weeks} of the last ${v.weeks} weeks; ${pace} this past month`;
  };
  const c3 = outlookCard("Momentum: last 8 weeks", "Funds with the most money put in or taken out over the past two months. Persistent flows often continue for a while.");
  outlookList(c3, building.map(([t, v]) => ({ name: assetName(t), value: fmtUsdBn(v.total_bn, true), why: streakWhy(v) })), "Money building");
  outlookList(c3, leaving.map(([t, v]) => ({ name: assetName(t), value: fmtUsdBn(v.total_bn, true), why: streakWhy(v) })), "Money leaving");
  grid.appendChild(c3);

  // 4. Price vs flow: quiet buying into weakness, selling into strength (past month).
  const m = d.windows["20"].assets;
  // Flows of 1% of a fund's size in a month are well beyond normal churn.
  const quiet = Object.entries(m).filter(([, v]) => v.intensity != null && v.intensity >= 0.01 && v.ret < 0).sort((a, b) => b[1].intensity - a[1].intensity);
  const selling = Object.entries(m).filter(([, v]) => v.intensity != null && v.intensity <= -0.01 && v.ret > 0).sort((a, b) => a[1].intensity - b[1].intensity);
  const c4 = outlookCard("Price and flow disagree", "Over the past month. Money going in while the price falls can mean investors are buying the dip; money leaving a rally can mean holders are cashing out.");
  const divRows = (rows, label) => rows.slice(0, 3).map(([t, v]) => ({
    name: assetName(t), value: fmtPct(v.ret), why: `${label} ${fmtUsdBn(Math.abs(v.net_flow_bn))}, ${fmtPct(Math.abs(v.intensity), 1, false)} of the fund`,
  }));
  if (quiet.length) outlookList(c4, divRows(quiet, "Price fell, yet investors put in"), "Buying the dip");
  if (selling.length) outlookList(c4, divRows(selling, "Price rose, yet investors pulled"), "Cashing out into strength");
  if (!quiet.length && !selling.length) outlookList(c4, [{ name: "No clear divergences", value: "", why: "Prices and flows mostly moved together this month." }]);
  grid.appendChild(c4);

  // 6 (placed first). Selloffs in perspective: how often, how deep, how long, and where we are.
  const done = d.selloffs.episodes.filter((e) => !e.ongoing);
  if (done.length) {
    const years = (parseDay(d.meta.as_of) - parseDay(d.selloffs.episodes[0].peak)) / (365.25 * 864e5);
    const months = Math.round((years * 12) / done.length);
    const last = d.selloffs.episodes[d.selloffs.episodes.length - 1];
    const c0 = outlookCard("Selloffs in perspective", `Drops of ${Math.round(d.selloffs.threshold * 100)}% or more are a normal part of investing. Here is what a typical one has looked like since 2016.`);
    const rows0 = [
      { name: "How often", value: `about every ${months} months`, why: `${done.length} completed selloffs in ${Math.round(years)} years` },
      { name: "Typical depth", value: fmtPct(median(done.map((e) => e.drawdown)), 0), why: `Deepest: ${fmtPct(Math.min(...done.map((e) => e.drawdown)), 0)} (${fmtMonth(done.reduce((a, b) => (a.drawdown < b.drawdown ? a : b)).peak)})` },
      { name: "Typical length", value: `${Math.round(median(done.map((e) => e.days)) / 5)} weeks`, why: "From the peak to the bottom, in trading weeks" },
      last && last.ongoing
        ? { name: "Right now", value: `${fmtPct(last.drawdown, 1)} so far`, why: `A selloff has been under way since ${fmtDate(last.peak)}` }
        : { name: "Right now", value: `${fmtPct(d.kpis.drawdown, 1)}`, why: `From the 1-year high. Last selloff ended ${fmtDate(done[done.length - 1].trough)}` },
    ];
    outlookList(c0, rows0);
    grid.prepend(c0);
  }

  // 5. Dry powder: cash that could come back into markets.
  const k = d.kpis;
  const c5 = outlookCard("Dry powder", "Cash parked on the sidelines is potential fuel for markets when sentiment turns.");
  const rows = [];
  const mmf = d.cash.retail_mmf;
  if (mmf && mmf.length > 12) {
    const last = mmf[mmf.length - 1];
    const ago = (mmf.find((x) => x[0] >= shiftDate(last[0], -365)) || mmf[0])[1];
    rows.push({ name: "Household money funds", value: fmtUsdBn(last[1]), why: `${fmtUsdBn(last[1] - ago, true)} over the past year` });
  }
  if (k.stablecoins_bn != null) rows.push({ name: "Stablecoins", value: fmtUsdBn(k.stablecoins_bn), why: `${fmtUsdBn(k.stablecoins_30d_bn, true)} in 30 days: ${k.stablecoins_30d_bn >= 0 ? "new buying power arriving in crypto" : "crypto's cash pile is shrinking"}` });
  if (k.net_liquidity_bn != null) rows.push({ name: "Fed net liquidity", value: fmtUsdBn(k.net_liquidity_bn), why: `${fmtUsdBn(k.net_liquidity_4w_bn, true)} in 4 weeks: ${k.net_liquidity_4w_bn >= 0 ? "a tailwind for markets" : "a mild headwind for markets"}` });
  outlookList(c5, rows);
  grid.appendChild(c5);
}

// ---------- cash buckets ----------

const CASH_PANELS = [
  { key: "stablecoins", title: "Stablecoin supply", note: "Crypto's cash pile" },
  { key: "retail_mmf", title: "Retail money funds", note: "Household cash parking" },
  { key: "rrp", title: "Overnight reverse repo", note: "Excess cash at the Fed" },
  { key: "tga", title: "Treasury General Account", note: "Rising drains liquidity" },
  { key: "net_liquidity", title: "Fed net liquidity", note: "Assets − TGA − RRP" },
];

// [date, value] points inside the range, plus the last point before it, so slow
// (weekly or monthly) series still have a starting value for the change.
function pointsInRange(pts, b = rangeBounds()) {
  const inside = pts.filter((x) => inRange(x[0], b));
  const before = pts.filter((x) => x[0] <= b.start);
  return before.length ? [before[before.length - 1], ...inside] : inside;
}

// Value at the end of the range and its change over the range, for a [date, value] series.
function changeOverRange(pts, b = rangeBounds()) {
  const r = pointsInRange(pts, b);
  if (!r.length) return [null, null];
  return [r[r.length - 1][1], r.length > 1 ? r[r.length - 1][1] - r[0][1] : null];
}

// Change text for a cash series: over the range, or the latest report when a slow
// (monthly) series has nothing new inside a short range.
function cashDelta(pts, b = rangeBounds()) {
  const [, change] = changeOverRange(pts, b);
  if (change != null) return `${fmtUsdBn(change, true)} ${rangeTileSpan()}`;
  const upto = pts.filter((x) => x[0] <= b.end);
  if (upto.length < 2) return "No data yet";
  const [prev, last] = upto.slice(-2);
  return `${fmtUsdBn(last[1] - prev[1], true)} in the latest report (${fmtMonth(last[0])})`;
}

// Chart points for a cash series: the range, widened to the last few reports for slow series.
function cashChartPoints(pts, b = rangeBounds()) {
  const r = pointsInRange(pts, b);
  return r.length >= 4 ? r : pts.filter((x) => x[0] <= b.end).slice(-6);
}

function renderCash(t) {
  $("#cash-sub").textContent = `Money that leaves risk assets mostly parks in cash-like places. Shaded bands are S&P 500 selloffs.${dollarsNote()}`;
  const grid = $("#cash-grid");
  const cash = state.data.cash;
  if (!grid.childElementCount) {
    CASH_PANELS.filter((p) => cash[p.key]).forEach((p) => {
      const card = document.createElement("article");
      card.className = "card mini";
      card.innerHTML = `<h3></h3><p class="muted small"></p><div class="figure"></div><p class="muted small delta"></p><div class="chart" id="chart-cash-${p.key}"></div>`;
      card.querySelector("h3").textContent = p.title;
      if (INFO[p.key]) card.querySelector("h3").appendChild(infoButton(p.title, p.key));
      card.querySelector("p").textContent = p.note;
      grid.appendChild(card);
    });
  }
  CASH_PANELS.filter((p) => cash[p.key]).forEach((p) => {
    const series = realPoints(cash[p.key]);
    const pts = cashChartPoints(series);
    const [value] = changeOverRange(series);
    const card = document.getElementById(`chart-cash-${p.key}`).parentElement;
    card.querySelector(".figure").textContent = fmtUsdBn(value);
    card.querySelector(".delta").textContent = cashDelta(series);
    chart(`chart-cash-${p.key}`).setOption({
      grid: { left: 44, right: 8, top: 10, bottom: 22 },
      tooltip: {
        ...tooltipBase(t),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps) => `<div style="margin-bottom:4px">${esc(fmtDate(ps[0].data[0]))}</div>` + row(p.title, fmtUsdBn(ps[0].data[1]), t.groups[0]),
      },
      xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 10, hideOverlap: true } },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 3,
        ...axisStyle(t),
        axisLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 10, formatter: fmtAxisUsd },
      },
      series: [{
        type: "line",
        data: pts,
        showSymbol: false,
        lineStyle: { width: 2, color: t.groups[0] },
        itemStyle: { color: t.groups[0] },
        markArea: selloffBands(t),
      }],
    }, true);
  });
}

function shiftDate(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- regime, performance, correlation ----------

// ---------- rates and credit ----------

const RATE_NOTES = {
  DGS10: "What the US government pays for 10 years",
  T10Y2Y: "Below zero is an inverted curve",
  DFII10: "10-year yield after expected inflation",
  BAMLH0A0HYM2: "Extra yield on junk bonds",
  NFCI: "Above zero is tighter than normal",
};

function fmtRate(v, unit) {
  if (v == null) return "–";
  return unit === "pct" ? `${fmtNum(v, 2)}%` : fmtNum(v, 2, true);
}

// Rate changes in basis points; index changes as plain numbers.
function fmtRateChange(v, unit) {
  if (v == null) return "–";
  return unit === "pct" ? `${fmtNum(v * 100, 0, true)} bp` : fmtNum(v, 2, true);
}

function renderRates(t) {
  const grid = $("#rates-grid");
  const rates = state.data.rates || {};
  const keys = Object.keys(RATE_NOTES).filter((k) => rates[k]);
  $("#rates").hidden = !keys.length;
  if (!keys.length) return;
  if (!grid.childElementCount) {
    keys.forEach((k) => {
      const card = document.createElement("article");
      card.className = "card mini";
      card.innerHTML = `<h3></h3><p class="muted small"></p><div class="figure"></div><p class="muted small delta"></p><div class="chart" id="chart-rate-${k}"></div>`;
      card.querySelector("h3").textContent = rates[k].name;
      card.querySelector("p").textContent = RATE_NOTES[k];
      grid.appendChild(card);
    });
  }
  keys.forEach((k) => {
    const r = rates[k];
    const pts = cashChartPoints(r.points);
    const [value, change] = changeOverRange(r.points);
    const card = document.getElementById(`chart-rate-${k}`).parentElement;
    card.querySelector(".figure").textContent = fmtRate(value, r.unit);
    const first = r.points[0][0];
    card.querySelector(".delta").textContent = change != null
      ? `${fmtRateChange(change, r.unit)} ${rangeTileSpan()}`
      : `No data before ${fmtMonth(first)}`;
    const lo = Math.min(...pts.map((p) => p[1]));
    const hi = Math.max(...pts.map((p) => p[1]));
    const zero = lo < 0 && hi > 0;
    // Narrow ranges need more decimals, or neighbouring ticks print the same.
    const digits = hi - lo < 0.3 ? 2 : 1;
    chart(`chart-rate-${k}`).setOption({
      grid: { left: 44, right: 8, top: 10, bottom: 22 },
      tooltip: {
        ...tooltipBase(t),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps) => `<div style="margin-bottom:4px">${esc(fmtDate(ps[0].data[0]))}</div>` + row(r.name, fmtRate(ps[0].data[1], r.unit), t.groups[1]),
      },
      xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 10, hideOverlap: true } },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 3,
        ...axisStyle(t),
        axisLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 10, formatter: (v) => (r.unit === "pct" ? `${fmtNum(v, digits)}%` : fmtNum(v, digits)) },
      },
      series: [{
        type: "line",
        data: pts,
        showSymbol: false,
        lineStyle: { width: 2, color: t.groups[1] },
        itemStyle: { color: t.groups[1] },
        markArea: selloffBands(t),
        markLine: zero ? { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid", width: 1 }, label: { show: false }, data: [{ yAxis: 0 }] } : undefined,
      }],
    }, true);
  });
}

// ---------- futures positioning ----------

// Where the speculators' net position at the end of the range sits among the three
// years of weekly readings before it (0 = most bearish, 100 = most bullish).
function crowding(p, b = rangeBounds()) {
  let i = -1;
  p.dates.forEach((d, j) => { if (d <= b.end) i = j; });
  if (i < 0 || p.spec_net[i] == null) return null;
  const from = shiftDate(p.dates[i], -3 * 365);
  const past = p.spec_net.filter((v, j) => v != null && j <= i && p.dates[j] > from);
  const v = p.spec_net[i];
  const pct = ((past.filter((x) => x < v).length + 0.5 * past.filter((x) => x === v).length) / past.length) * 100;
  return {
    i, date: p.dates[i], pct, net: v,
    change: i > 0 && p.spec_net[i - 1] != null ? v - p.spec_net[i - 1] : null,
    oi: p.open_interest[i],
    am: p.am_net ? p.am_net[i] : null,
  };
}

function fmtContracts(v, signed = true) {
  if (v == null) return "–";
  const a = Math.abs(v);
  const txt = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k` : `${Math.round(a)}`;
  return `${v < 0 ? MINUS : signed && v > 0 ? "+" : ""}${txt}`;
}

function ordinal(n) {
  const r = Math.round(n);
  const s = ["th", "st", "nd", "rd"];
  const v = r % 100;
  return `${r}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// Where an extreme sits: "longest" only makes sense for a net long position. Hedge funds
// are structurally short Treasury and bitcoin futures (the basis trade), so a top reading
// there means "least short".
function extremeWord(pct, net) {
  if (pct >= 85) return net >= 0 ? "near their longest" : "near their least short";
  return net <= 0 ? "near their shortest" : "near their least long";
}

// Plain reading of a percentile: crowded long, crowded short, or neither.
function crowdLabel(pct, net) {
  if (pct >= 85) return net >= 0 ? "Crowded long" : "Least short in 3 years";
  if (pct <= 15) return net <= 0 ? "Crowded short" : "Least long in 3 years";
  if (pct >= 65) return "Leaning long";
  if (pct <= 35) return "Leaning short";
  return "Middle of the range";
}

function renderPositioning(t) {
  const list = state.data.positioning || [];
  $("#positioning").hidden = !list.length;
  if (!list.length) return;
  const b = rangeBounds();
  const rows = list.map((p) => ({ p, c: crowding(p, b) })).filter((r) => r.c).sort((a, z) => a.c.pct - z.c.pct);
  const asOf = rows.length ? rows.reduce((m, r) => (r.c.date > m ? r.c.date : m), "") : null;
  $("#crowding-sub").textContent = `Their net position on ${asOf ? fmtDate(asOf) : "the latest report"} as a percentile of the three years before it. 100 is the most bullish in that time, 0 the most bearish.`;
  const c = chart("chart-crowding");
  if (!rows.length) {
    emptyChart(c, t, "No positioning data for this range");
    return;
  }
  const label = (r) => narrowScreen() ? r.p.name.replace(" futures", "") : r.p.name;
  c.setOption({
    grid: { ...barGrid(), top: 24 },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (q) => {
        const r = rows[q.dataIndex];
        return `<div style="margin-bottom:4px">${esc(r.p.name)} · ${esc(fmtDate(r.c.date))}</div>` +
          row(`${r.p.who}, net`, fmtContracts(r.c.net)) +
          row("Percentile, 3 years", ordinal(r.c.pct)) +
          row("Change on the week", fmtContracts(r.c.change)) +
          (r.c.oi ? row("Share of open interest", fmtPct(r.c.net / r.c.oi, 1)) : "") +
          (r.c.am != null ? row("Asset managers, net", fmtContracts(r.c.am)) : "");
      },
    },
    xAxis: {
      type: "value", min: -50, max: 50, interval: 25,
      ...axisStyle(t),
      axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => `${v + 50}` },
      splitLine: { lineStyle: { color: t.grid } },
    },
    yAxis: { type: "category", data: rows.map(label), ...axisStyle(t), axisLabel: { color: t.text2, fontSize: 12 }, splitLine: { show: false } },
    series: [{
      type: "bar",
      barWidth: "60%",
      data: rows.map((r) => {
        const v = r.c.pct - 50;
        const extreme = r.c.pct >= 85 || r.c.pct <= 15;
        return {
          value: v,
          // Long bars to the left carry their label inside, clear of the market names.
          label: v < -35
            ? { show: true, position: "insideLeft", color: "#ffffff", fontSize: 11, formatter: () => ordinal(r.c.pct) }
            : { show: true, position: v < 0 ? "left" : "right", color: t.text2, fontSize: 11, formatter: () => ordinal(r.c.pct) },
          itemStyle: { color: v >= 0 ? t.pos : t.neg, opacity: extreme ? 1 : 0.45, borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
        };
      }),
      markLine: {
        silent: true, symbol: "none",
        lineStyle: { color: t.axis, type: "dashed", width: 1 },
        label: { color: t.muted, fontSize: 10, formatter: (q) => (q.value > 0 ? "Crowded long" : "Crowded short"), position: "end" },
        data: [{ xAxis: 35 }, { xAxis: -35 }],
      },
    }],
  }, true);
  c.off("click");
  c.on("click", (q) => { state.position = rows[q.dataIndex].p.key; renderPositionHistory(theme()); });
  table(cardTable("crowding"), ["Futures market", "Who", "Net contracts", "Week change", "Percentile (3y)", "Reading"],
    rows.slice().reverse().map((r) => [r.p.name, r.p.who, fmtContracts(r.c.net), fmtContracts(r.c.change), ordinal(r.c.pct), crowdLabel(r.c.pct, r.c.net)]));
  renderPositionHistory(t);
}

function renderPositionHistory(t) {
  const list = state.data.positioning || [];
  const select = $("#positions-select");
  if (!select.childElementCount) {
    list.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.key;
      o.textContent = p.name;
      select.appendChild(o);
    });
    select.addEventListener("change", () => { state.position = select.value; renderPositionHistory(theme()); });
  }
  const p = list.find((x) => x.key === state.position) || list[0];
  if (!p) return;
  state.position = p.key;
  select.value = p.key;
  $("#positions-title").textContent = `Net position: ${p.name}`;
  // Weekly reports: widen short ranges to the last few months so there is a line to read.
  const b = rangeBounds();
  let idx = p.dates.map((d, i) => (inRange(d, b) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 8) {
    const last = p.dates.map((d, i) => (d <= b.end ? i : -1)).filter((i) => i >= 0);
    idx = last.slice(-13);
  }
  $("#positions-sub").textContent = `Contracts long minus contracts short, weekly.${idx.length && !inRange(p.dates[idx[0]], b) ? " Shown for the last three months, since the range holds few weekly reports." : ""} Click a bar on the left to switch market.`;
  const series = [lineSeries(t, p.who, idx.map((i) => [p.dates[i], p.spec_net[i]]), t.groups[0], {
    markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid", width: 1 }, label: { show: false }, data: [{ yAxis: 0 }] },
    markArea: selloffBands(t),
  })];
  if (p.am_net) series.push(lineSeries(t, "Asset managers", idx.map((i) => [p.dates[i], p.am_net[i]]), t.groups[3]));
  chart("chart-positions").setOption(lineOptions(t, {
    series,
    yFormatter: (v) => fmtContracts(v, false),
    valueFormatter: (v) => `${fmtContracts(v)} contracts`,
  }), true);
  table(cardTable("positions"), ["Report date", p.who, ...(p.am_net ? ["Asset managers"] : []), "Open interest"],
    idx.map((i) => [fmtDate(p.dates[i]), fmtContracts(p.spec_net[i]), ...(p.am_net ? [fmtContracts(p.am_net[i])] : []), fmtContracts(p.open_interest[i], false)]).reverse());
}

function lineOptions(t, { series, yFormatter, yMin, yMax, valueFormatter }) {
  return {
    // Phones: the legend wraps to two rows and end labels would be clipped, so give the
    // legend room and let it carry the names.
    grid: narrowScreen() ? { left: 40, right: 12, top: 60, bottom: 28 } : { left: 48, right: 110, top: 36, bottom: 28 },
    legend: {
      top: 0,
      left: 0,
      icon: "path://M0,0 L12,0 L12,2 L0,2 Z",
      itemWidth: 12,
      itemHeight: 2,
      textStyle: { color: t.text2, fontSize: 12 },
      inactiveColor: t.grid,
    },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.axis } },
      formatter: (ps) => {
        const sorted = ps.filter((p) => p.data[1] != null).sort((a, b) => b.data[1] - a.data[1]);
        return `<div style="margin-bottom:4px">${esc(fmtDate(ps[0].data[0]))}</div>` +
          sorted.map((p) => row(p.seriesName, valueFormatter(p.data[1]), p.color)).join("");
      },
    },
    xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true } },
    yAxis: { type: "value", min: yMin, max: yMax, scale: yMin == null, ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: yFormatter } },
    series,
  };
}

function lineSeries(t, name, data, color, extra = {}) {
  return {
    type: "line",
    name,
    data,
    showSymbol: false,
    connectNulls: true,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    endLabel: { show: !narrowScreen(), formatter: "{a}", color: t.text2, fontSize: 11 },
    labelLayout: { moveOverlap: "shiftY" },
    emphasis: { focus: "series" },
    ...extra,
  };
}

function renderRegime(t) {
  const r = state.data.regime;
  const b = rangeBounds();
  const hist = r.history.filter(([d]) => inRange(d, b));
  chart("chart-regime").setOption({
    ...lineOptions(t, {
      series: [lineSeries(t, "Risk appetite", hist, t.groups[0], {
        endLabel: { show: false },
        markArea: selloffBands(t),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: t.axis, type: "solid", width: 1 },
          label: { color: t.muted, fontSize: 11, position: "end" },
          data: [{ yAxis: 0.5, label: { formatter: "Risk-on" } }, { yAxis: -0.5, label: { formatter: "Risk-off" } }],
        },
      })],
      yFormatter: (v) => fmtNum(v, 1, true),
      valueFormatter: (v) => fmtNum(v, 2, true),
    }),
    legend: { show: false },
    grid: { left: 40, right: 64, top: 12, bottom: 28 },
  }, true);
  const ul = $("#regime-components");
  ul.replaceChildren();
  Object.entries(r.components).forEach(([name, z]) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    const clamped = Math.max(-2, Math.min(2, z ?? 0));
    const width = (Math.abs(clamped) / 4) * 100;
    fill.style.width = `${width}%`;
    fill.style.left = clamped >= 0 ? "50%" : `${50 - width}%`;
    fill.style.background = clamped >= 0 ? t.pos : t.neg;
    bar.appendChild(fill);
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = fmtNum(z, 1, true);
    li.append(label, bar, num);
    ul.appendChild(li);
  });
  table(cardTable("regime"), ["Date", "Score", "Regime"],
    hist.slice().reverse().filter((_, i) => i % 5 === 0).map(([d, v]) => [fmtDate(d), fmtNum(v, 2, true), v >= 0.5 ? "Risk-on" : v <= -0.5 ? "Risk-off" : "Neutral"]));
}

// Prices for the range, indexed to 100 at its start: daily rows when they cover the range,
// monthly closes otherwise.
function performanceInRange() {
  const b = rangeBounds();
  const D = state.data.series.daily;
  const M = state.data.series.monthly;
  const daily = b.start >= D.dates[0];
  const src = daily ? D : M;
  const dates = daily ? D.dates : M.end;
  const idx = dates.map((d, i) => (daily ? inRange(d, b) : overlapsRange(M.start[i], d, b)) ? i : -1).filter((i) => i >= 0);
  if (idx.length && idx[0] > 0) idx.unshift(idx[0] - 1); // start from the close just before the range
  const series = {};
  Object.keys(src.close).forEach((tk) => {
    const closes = idx.map((i) => realPrice(src.close[tk][i], dates[i]));
    const base = closes.find((v) => v != null);
    series[tk] = closes.map((v) => (v == null || !base ? null : Math.round((v / base) * 1000) / 10));
  });
  return { dates: idx.map((i) => dates[i]), series };
}

function renderPerformance(t) {
  $("#performance-sub").textContent = state.real
    ? "One market per class, after inflation, indexed to 100 at the start of the selected range."
    : "One market per class, indexed to 100 at the start of the selected range.";
  const p = performanceInRange();
  const tickers = REPRESENTATIVES.filter((tk) => p.series[tk]);
  chart("chart-performance").setOption(lineOptions(t, {
    series: tickers.map((tk) => lineSeries(t, assetName(tk), p.dates.map((d, i) => [d, p.series[tk][i]]), assetColor(tk, t))),
    yFormatter: (v) => v.toFixed(0),
    valueFormatter: (v) => v.toFixed(1),
  }), true);
  const step = p.dates.length > 120 ? 5 : 1;
  table(cardTable("performance"), ["Date", ...tickers.map(assetName)],
    p.dates.map((d, i) => [fmtDate(d), ...tickers.map((tk) => (p.series[tk][i] == null ? "–" : p.series[tk][i].toFixed(1)))])
      .filter((_, i, arr) => (arr.length - 1 - i) % step === 0).reverse());
}

function renderCorrelation(t) {
  const b = rangeBounds();
  const all = state.data.correlations;
  const src = all.daily && b.start >= all.daily.dates[0] ? all.daily : all;
  const idx = src.dates.map((d, i) => (inRange(d, b) ? i : -1)).filter((i) => i >= 0);
  const c = { dates: idx.map((i) => src.dates[i]), series: Object.fromEntries(Object.entries(src.series).map(([k, v]) => [k, idx.map((i) => v[i])])) };
  // One market per class, so no two lines share a colour.
  const seen = new Set();
  const tickers = Object.keys(c.series).filter((tk) => {
    const g = state.assets[tk] && state.assets[tk].group;
    if (seen.has(g)) return false;
    seen.add(g);
    return true;
  });
  chart("chart-correlation").setOption(lineOptions(t, {
    series: tickers.map((tk, idx) => lineSeries(t, assetName(tk), c.dates.map((d, i) => [d, c.series[tk][i]]), assetColor(tk, t), idx === 0 ? {
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid", width: 1 }, label: { show: false }, data: [{ yAxis: 0 }] },
    } : {})),
    yMin: -1,
    yMax: 1,
    yFormatter: (v) => fmtNum(v, 1, true),
    valueFormatter: (v) => fmtNum(v, 2, true),
  }), true);
  table(cardTable("correlation"), ["Date", ...tickers.map(assetName)],
    c.dates.map((d, i) => [fmtDate(d), ...tickers.map((tk) => fmtNum(c.series[tk][i], 2, true))]).reverse());
}

// ---------- orchestration ----------

function showError(message) {
  const b = $("#warnings");
  b.hidden = false;
  const line = document.createElement("div");
  line.textContent = message;
  b.appendChild(line);
}

// Each panel renders on its own, so one failure can't blank the rest of the page.
function safely(name, fn, t) {
  try {
    fn(t);
  } catch (err) {
    console.error(err);
    showError(`The ${name} panel failed to draw: ${err.message}`);
  }
}

function renderAll() {
  const t = theme();
  safely("summary", renderNow);
  syncRangeControls();
  safely("headline", renderKpis);
  safely("liquidity wheel", renderWheel, t);
  safely("rotation map", renderSankey, t);
  safely("flow share", renderIntensity, t);
  safely("liquidity history", renderHistory, t);
  safely("market close-up", renderCloseup, t);
  safely("selloff playbook", renderPlaybook, t);
  safely("selloff heatmap", renderHeatmap, t);
  safely("outlook", renderOutlook);
  safely("positioning", renderPositioning, t);
  safely("cash", renderCash, t);
  safely("rates", renderRates, t);
  safely("risk appetite", renderRegime, t);
  safely("performance", renderPerformance, t);
  safely("correlation", renderCorrelation, t);
}

// ---------- range controls ----------

function buildRangeControls() {
  const box = $("#range-presets");
  box.replaceChildren();
  RANGE_PRESETS.forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.range = key;
    b.textContent = label;
    b.addEventListener("click", () => setRange({ preset: key }));
    box.appendChild(b);
  });
  const from = $("#range-from");
  const to = $("#range-to");
  from.min = to.min = "2016-01-01";
  from.max = to.max = state.data.meta.as_of;
}

function setReal(on) {
  state.real = on && !!cpiLatest();
  state.aggCache = null;
  // A replay was computed in the old units; rebuild it from its key.
  if (state.replay) state.replay = viewFromKey(state.replay.key);
  storage("set", "lfm-real", state.real ? "1" : "0");
  writeHash();
  renderAll();
}

function syncRangeControls() {
  const box = $("#real-toggle");
  box.checked = state.real;
  box.disabled = !cpiLatest();
  if (box.disabled) box.parentElement.title = "Inflation data (CPI) is unavailable in this build";
  const custom = state.range.preset === "custom";
  document.querySelectorAll("#range-presets button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.range === state.range.preset)));
  $("#range-custom-toggle").setAttribute("aria-pressed", String(custom));
  const b = rangeBounds();
  if (!$("#range-from").value || custom) $("#range-from").value = b.start < "2016-01-01" ? "2016-01-01" : b.start;
  if (!$("#range-to").value || custom) $("#range-to").value = b.end;
}

function setRange(range, { persist = true } = {}) {
  state.range = { preset: range.preset, start: range.start || null, end: range.end || null };
  state.aggCache = null;
  state.replay = null;
  state.history.kind = autoGrain();
  syncReplayControls();
  if (persist) storage("set", "lfm-range", JSON.stringify(state.range));
  writeHash();
  renderAll();
}

function applyCustomRange() {
  let start = $("#range-from").value;
  let end = $("#range-to").value;
  if (!start || !end) return;
  if (start > end) [start, end] = [end, start];
  setRange({ preset: "custom", start, end });
}

// Shareable links: the view lives in the URL hash
// (#range=3M&r=ep:12&m=GLD&hk=monthly&hm=cumulative, or from=…&to=… for a custom range).
function writeHash() {
  if (!state.data) return;
  const params = new URLSearchParams();
  if (state.real) params.set("real", "1");
  if (state.range.preset === "custom") {
    params.set("from", state.range.start);
    params.set("to", state.range.end);
  } else {
    params.set("range", state.range.preset);
  }
  if (state.replay) params.set("r", state.replay.key);
  if (state.market !== "SPY") params.set("m", state.market);
  if (state.history.kind !== autoGrain()) params.set("hk", state.history.kind);
  if (state.history.mode !== "flows") params.set("hm", state.history.mode);
  history.replaceState(null, "", `#${params}`);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (![...params.keys()].length) return;
  const d = state.data;
  const legacy = { 5: "1W", 20: "1M", 60: "3M" }[params.get("w")];
  const preset = params.get("range") || legacy;
  if (RANGE_INFO[preset]) state.range = { preset, start: null, end: null };
  if (params.has("real")) state.real = params.get("real") === "1" && !!cpiLatest();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(params.get("from") || "") && iso.test(params.get("to") || "")) {
    state.range = { preset: "custom", start: params.get("from"), end: params.get("to") };
  }
  state.history.kind = autoGrain();
  if (["daily", "weekly", "monthly"].includes(params.get("hk")) && grainAvailable(params.get("hk"))) state.history.kind = params.get("hk");
  if (["flows", "cumulative"].includes(params.get("hm"))) state.history.mode = params.get("hm");
  if (params.get("m") && state.assets[params.get("m")]) state.market = params.get("m");
  try {
    const v = viewFromKey(params.get("r"));
    if (v && v.wheel) state.replay = v;
  } catch (e) {
    state.replay = null;
  }
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

async function share() {
  writeHash();
  const url = location.href;
  try {
    if (navigator.share && narrowScreen()) {
      await navigator.share({ title: "Liquidity Flow Monitor", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast("Link to this view copied");
  } catch (e) {
    if (e && e.name === "AbortError") return;
    window.prompt("Copy this link:", url);
  }
}

function storage(op, key, value) {
  try {
    return op === "get" ? localStorage.getItem(key) : localStorage.setItem(key, value);
  } catch (e) {
    return null;
  }
}

function applyTheme(mode) {
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  $("#theme-toggle").textContent = `Theme: ${mode}`;
}

function wireControls() {
  $("#range-custom-toggle").addEventListener("click", () => {
    const box = $("#custom-range");
    box.hidden = !box.hidden;
    $("#range-custom-toggle").setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) $("#range-from").focus();
  });
  $("#range-apply").addEventListener("click", applyCustomRange);
  $("#real-toggle").addEventListener("change", (ev) => setReal(ev.target.checked));
  ["range-from", "range-to"].forEach((id) => $(`#${id}`).addEventListener("keydown", (ev) => { if (ev.key === "Enter") applyCustomRange(); }));

  document.querySelectorAll(".table-toggle").forEach((btn) => {
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const showTable = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(showTable));
      btn.textContent = showTable ? "Chart" : "Table";
      card.querySelector(".chart").hidden = showTable;
      card.querySelector(".table-wrap").hidden = !showTable;
      if (!showTable) Object.values(state.charts).forEach((c) => c.resize());
    });
  });

  const modes = ["auto", "light", "dark"];
  let mode = storage("get", "lfm-theme") || "auto";
  if (!modes.includes(mode)) mode = "auto";
  applyTheme(mode);
  $("#theme-toggle").addEventListener("click", () => {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    storage("set", "lfm-theme", mode);
    applyTheme(mode);
    renderAll();
  });
  setFlowPaused(state.flowPaused);
  $("#flow-toggle").addEventListener("click", () => setFlowPaused(!state.flowPaused));
  reducedMotion.addEventListener("change", (e) => setFlowPaused(e.matches));
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      state.wheelVisible = entry.isIntersecting;
      runFlow();
    }).observe(document.getElementById("chart-wheel"));
  }

  $("#replay-select").addEventListener("change", (ev) => {
    const view = viewFromKey(ev.target.value);
    if (view) replay(view, false);
    else exitReplay();
  });
  $("#replay-exit").addEventListener("click", exitReplay);
  $("#closeup-select").addEventListener("change", (ev) => openCloseup(ev.target.value, false));
  $("#share").addEventListener("click", share);
  document.querySelectorAll("#history-kind button").forEach((b) => b.addEventListener("click", () => {
    state.history.kind = b.dataset.kind;
    writeHash();
    safely("liquidity history", renderHistory, theme());
  }));
  document.querySelectorAll("#history-mode button").forEach((b) => b.addEventListener("click", () => {
    state.history.mode = b.dataset.mode;
    writeHash();
    safely("liquidity history", renderHistory, theme());
  }));

  if ("IntersectionObserver" in window) {
    const links = new Map([...document.querySelectorAll(".section-nav a")].map((a) => [a.getAttribute("href").slice(1), a]));
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((a) => a.removeAttribute("aria-current"));
        const a = links.get(e.target.id);
        if (a) {
          a.setAttribute("aria-current", "true");
          // Keep the active link visible in the horizontally scrolling menu without moving the page.
          const nav = a.parentElement;
          if (a.offsetLeft < nav.scrollLeft || a.offsetLeft + a.offsetWidth > nav.scrollLeft + nav.clientWidth) {
            nav.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
          }
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    links.forEach((_, id) => { const el = document.getElementById(id); if (el) spy.observe(el); });
  }

  document.addEventListener("pointerdown", (ev) => {
    if (state.wheelReset && !ev.target.closest("#chart-wheel")) state.wheelReset();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (mode === "auto") renderAll();
  });

  let pending;
  window.addEventListener("resize", () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      Object.values(state.charts).forEach((c) => c.resize());
      if (state.data) {
        safely("liquidity wheel", renderWheel, theme());
        safely("rotation map", renderSankey, theme());
      }
    }, 120);
  });
}

async function main() {
  if (typeof d3 === "undefined") {
    showError("The wheel library (vendor/d3-7.9.0.min.js) did not load, so the liquidity wheel can't be drawn. Try reloading the page.");
  }
  if (typeof echarts === "undefined") {
    showError("The chart library (vendor/echarts-5.5.1.min.js) did not load, so charts can't be drawn. Try reloading the page.");
  }
  wireControls();
  let data;
  try {
    const resp = await fetch("data/dashboard.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    const b = $("#warnings");
    b.hidden = false;
    b.textContent = `Could not load data/dashboard.json (${err.message}). Serve the docs/ folder over HTTP, e.g. "python -m http.server -d docs".`;
    return;
  }
  state.data = data;
  data.assets.forEach((a) => { state.assets[a.ticker] = a; });
  data.groups.forEach((g, i) => { state.groupIndex[g] = i; });

  buildReplaySelect();
  buildCloseupSelect();
  buildRangeControls();
  try {
    const saved = JSON.parse(storage("get", "lfm-range") || "null");
    if (saved && (RANGE_INFO[saved.preset] || (saved.preset === "custom" && saved.start && saved.end))) state.range = saved;
  } catch (e) {
    // ignore a malformed saved range
  }
  state.history.kind = autoGrain();
  state.real = storage("get", "lfm-real") === "1" && !!cpiLatest();
  readHash();
  syncReplayControls();

  $("#demo-banner").hidden = !data.meta.demo;
  $("#asof").textContent = `Data through ${fmtDate(data.meta.as_of)}`;
  $("#updated").textContent = `· updated ${relativeTime(data.meta.generated_at)}`;
  $("#updated").title = new Date(data.meta.generated_at).toLocaleString();
  if (data.meta.warnings && data.meta.warnings.length) {
    const b = $("#warnings");
    b.hidden = false;
    b.textContent = `Some sources failed on the last refresh: ${data.meta.warnings.join("; ")}`;
  }
  $("#sources").textContent = "Sources: " + data.meta.sources.map((s) => `${s.name} (${s.detail})`).join(" · ") +
    `. Generated ${data.meta.generated_at}.`;

  renderAll();
}

main();
