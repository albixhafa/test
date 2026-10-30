"use strict";

const state = { data: null, charts: {}, assets: {}, groupIndex: {} };
// Money entering the tracked funds from outside, or leaving them altogether.
const SIDELINES = "Sidelines";
// One market per class for the performance chart.

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
  // A word joiner keeps the sign on the same line as the number when text wraps.
  if (x < 0) return `${MINUS}\u2060${body}`;
  return (signed && x > 0 ? "+\u2060" : "") + body;
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

function csvCell(v) {
  const s = String(v ?? "").replace(/\u2212/g, "-").replace(/\u2060/g, "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A "Download CSV" button for a table's headers and text rows.
function csvButton(title, headers, rows) {
  const dl = document.createElement("button");
  dl.type = "button";
  dl.className = "ghost small csv";
  dl.textContent = "Download CSV";
  dl.addEventListener("click", () => {
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${state.data.meta.as_of}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });
  return dl;
}

function table(container, headers, rows) {
  // Every table can be downloaded as CSV, named after its card.
  const card = container.closest("[data-card]");
  const title = (card && (card.dataset.title || (card.querySelector("h3") && card.querySelector("h3").textContent)) || "table").trim();
  const dl = csvButton(title, headers, rows);
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
  container.replaceChildren(...(rows.length ? [dl] : []), tbl);
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
  btc: "Bitcoin's price change over the past month. It tends to move with investors' appetite for risk.",
  stablecoins: "Crypto tokens pegged to the dollar, such as USDT and USDC. Their total supply is cash sitting on crypto rails, ready to buy.",
  mmf_total: "Every US money market fund, retail and institutional, from the Treasury's Office of Financial Research (SEC filings, monthly, about a month behind). This is the biggest pool of cash on the sidelines. Its net flows are estimated as the change in assets minus the interest those assets earned at the T-bill rate.",
  retail_mmf: "Money market funds held by households: where savers park cash that isn't in stocks or bonds. A rising total is money on the sidelines.",
  net_liquidity: "The Federal Reserve's balance sheet minus the Treasury's cash account and the reverse repo facility. A rough gauge of cash available to markets; when it rises, asset prices tend to get support.",
  rrp: "Money market funds lending spare cash to the Fed overnight. A big balance means idle cash; it drained toward zero as that cash moved into T-bills and markets.",
  tga: "The US government's checking account at the Fed. When it fills up, cash is pulled out of banks and markets; when it is spent down, cash flows back.",
  flows: "Real money, not estimates. Every State Street SPDR fund reports its shares outstanding daily; new shares times the share price is money put in, cancelled shares money taken out. Crypto's flow is the change in total stablecoin supply. SPDR funds are a large, consistent slice of US ETFs, not the whole market, so read sizes as a sample and directions as the signal. Markets without an SPDR fund (Nasdaq 100, small caps, bitcoin, the dollar) are tracked for price only.",
  pools: "Stocks: US companies' shares, listed and private (Federal Reserve Financial Accounts, quarterly), carried month to month by the S&P 500. Real estate: homes and land owned by households (Financial Accounts, quarterly), carried by the Case-Shiller home price index; property owned by companies is already inside their shares. Bonds: marketable US Treasuries at market value (Dallas Fed) plus company bonds. Cash: the M2 money supply plus companies' money market funds. Gold: all gold ever mined (World Gold Council estimate) times the gold price. Crypto: bitcoin and ether in circulation times their prices, plus stablecoins. US figures for stocks, real estate, bonds and cash; global for gold and crypto. Values move with prices: when markets fall, the value falls without any money leaving.",
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

// ---------- now: the answer in plain words ----------

const SIGNAL_TEXT = {
  "Equities": ["Stocks have had an unusually strong month.", "Stocks have had an unusually weak month."],
  "Small vs large caps": ["Small companies are beating big ones, a sign of broad confidence.", "Small companies are lagging big ones: investors are getting choosier."],
  "Credit vs Treasuries": ["Riskier bonds are beating safe Treasuries: credit markets are relaxed.", "Riskier bonds are lagging safe Treasuries, which often comes before stress in stocks."],
  "Bitcoin": ["Crypto is unusually strong.", "Crypto is under unusual pressure."],
  "Dollar (inverted)": ["The dollar is weakening unusually fast, which usually helps risk assets.", "The dollar is rising unusually fast, a classic flight to safety."],
  "Volatility (inverted)": ["Expected volatility is unusually low: markets are calm.", "Expected volatility (VIX) is unusually high: markets are nervous."],
};

function listText(items) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function median(xs) {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ---------- tooltips ----------


function hideTip() {
  $("#tip").hidden = true;
}

// What the class bars say in one line: the biggest inflow and outflow, both measured.
function classHeadline(view) {
  const ranked = Object.entries(view.wheel.net).filter(([g]) => g !== SIDELINES).sort((x, z) => z[1] - x[1]);
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const parts = [];
  if (top && top[1] > 0.05) parts.push(`${top[0].toLowerCase()} took in the most (${fmtUsdBn(top[1], true)})`);
  if (bottom && bottom[1] < -0.05) parts.push(`${bottom[0].toLowerCase()} lost the most (${fmtUsdBn(bottom[1], true)})`);
  if (!parts.length) return `Little money moved in or out ${view.span}`;
  return `${capitalise(view.span)}, ${parts.join(" and ")}`;
}

// ---------- views: the selected range, a past week or month, or a past selloff ----------

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
  if (state.tabs.flows !== "classes") showTab("flows", "classes", { render: false, hash: false });
  writeHash();
  safely("classes", renderClasses, theme());
  if (scroll) $("#flows").scrollIntoView({ behavior: "smooth", block: "start" });
}

function exitReplay() {
  state.replay = null;
  syncReplayControls();
  writeHash();
  safely("classes", renderClasses, theme());
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

// ---------- classes: money in and out of each class, opening into its funds ----------

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

state.openClasses = new Set();

// A bar that grows left (money out) or right (money in) from a centre line.
function divergingBar(value, max, color) {
  const bar = document.createElement("span");
  bar.className = "dbar";
  const fill = document.createElement("span");
  fill.className = "fill";
  const width = max > 0 ? (Math.min(Math.abs(value), max) / max) * 50 : 0;
  fill.style.background = color;
  fill.style.left = value >= 0 ? "50%" : `${50 - width}%`;
  fill.dataset.width = `${width}%`;
  fill.style.width = reducedMotion.matches ? `${width}%` : "0%";
  bar.appendChild(fill);
  return bar;
}

function renderClasses(t) {
  const view = currentView();
  const net = view.wheel.net;
  const nets = view.marketNets || {};
  const agg = state.replay ? null : aggregate().assets;
  $("#classes-headline").textContent = classHeadline(view);
  $("#classes-sub").textContent = `${fmtRange(view.start, view.end)}. Real money into and out of State Street funds and stablecoins.${dollarsNote()}`;
  $("#classes-sub").appendChild(infoButton("Where the flows come from", "flows"));
  const fresh = -(net[SIDELINES] || 0);
  $("#classes-total").textContent = fresh >= 0
    ? `New money in: ${fmtUsdBn(fresh, true)}`
    : `Money out of the tracked funds: ${fmtUsdBn(fresh, true)}`;
  $("#classes-mmf").textContent = mmfNote(view);

  const classes = state.data.groups.filter((g) => g !== SIDELINES).map((g) => ({
    g,
    v: net[g] || 0,
    funds: state.data.assets.filter((a) => a.group === g && nets[a.ticker] != null)
      .map((a) => ({ tk: a.ticker, v: nets[a.ticker], share: agg && agg[a.ticker] ? agg[a.ticker].intensity : null }))
      .sort((x, z) => z.v - x.v),
  })).sort((x, z) => z.v - x.v);
  const max = Math.max(...classes.map((c) => Math.abs(c.v)), ...classes.flatMap((c) => c.funds.map((f) => Math.abs(f.v)))) || 1;

  const list = $("#class-bars");
  list.replaceChildren();
  const rowParts = (row, name, value, color, extra) => {
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = name;
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = fmtUsdBn(value, true);
    if (extra) {
      const sm = document.createElement("span");
      sm.className = "share";
      sm.textContent = extra;
      num.appendChild(sm);
    }
    row.append(nm, divergingBar(value, max, color), num);
  };
  classes.forEach((c) => {
    const li = document.createElement("li");
    li.className = "cls";
    const open = state.openClasses.has(c.g) && c.funds.length > 0;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "cls-row";
    head.setAttribute("aria-expanded", String(open));
    const key = document.createElement("span");
    key.className = "key";
    key.style.background = groupColor(t, c.g);
    head.appendChild(key);
    rowParts(head, c.g, c.v, c.v >= 0 ? t.pos : t.neg);
    const chev = document.createElement("span");
    chev.className = "chev";
    chev.textContent = c.funds.length ? "›" : "";
    head.appendChild(chev);
    li.appendChild(head);
    const sub = document.createElement("ul");
    sub.className = "fund-rows";
    sub.hidden = !open;
    c.funds.forEach((f) => {
      const fli = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fund-row";
      btn.setAttribute("aria-label", `${assetName(f.tk)}: ${fmtUsdBn(f.v, true)}. Open its price and flows.`);
      rowParts(btn, shortName(f.tk), f.v, f.v >= 0 ? t.pos : t.neg, f.share != null ? ` ${fmtPct(f.share, 1)}` : "");
      btn.addEventListener("click", () => openCloseup(f.tk));
      fli.appendChild(btn);
      sub.appendChild(fli);
    });
    if (c.funds.length) {
      head.addEventListener("click", () => {
        const now = sub.hidden;
        sub.hidden = !now;
        head.setAttribute("aria-expanded", String(now));
        if (now) state.openClasses.add(c.g);
        else state.openClasses.delete(c.g);
        growBars(sub);
      });
    }
    li.appendChild(sub);
    list.appendChild(li);
  });
  growBars(list);

  const rows = [];
  classes.forEach((c) => {
    rows.push([c.g, "All tracked funds", fmtUsdBn(c.v, true), ""]);
    c.funds.forEach((f) => rows.push([c.g, assetName(f.tk), fmtUsdBn(f.v, true), f.share != null ? fmtPct(f.share, 1) : ""]));
  });
  rows.push(["Net new money", "", fmtUsdBn(fresh, true), ""]);
  table(cardTable("classes"), ["Class", "Fund", "Net flow", "Share of fund"], rows);
}

// Bars grow from the centre line when they first appear (instant with reduced motion).
function growBars(root) {
  requestAnimationFrame(() => root.querySelectorAll(".dbar .fill").forEach((f) => { f.style.width = f.dataset.width; }));
}

// ---------- where the money sits: holdings by class, stacked month by month ----------

state.pools = { grain: "month", scale: "linear" };
const POOL_NAMES = { "Gold & commodities": "Gold" };
const poolName = (g) => POOL_NAMES[g] || g;
// Real estate is not a flow class, so it takes the one palette slot the classes leave free.
const poolColor = (t, g) => (g === "Real estate" ? t.groups[6] : groupColor(t, g));
// Diagonal stripes for the month or year still in progress.
const STRIPES = { symbol: "rect", symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [3, 3], rotation: Math.PI / 4, color: "rgba(0, 0, 0, 0.32)" };

// Trillions read best rounded: $148T, $9.4T, $620B.
function fmtPool(v) {
  if (v == null) return "–";
  if (v === 0) return "$0";
  const a = Math.abs(v);
  return a >= 9950 ? `$${(a / 1000).toFixed(0)}T` : a >= 999.5 ? `$${(a / 1000).toFixed(1)}T` : fmtUsdBn(a);
}

// The months (or year ends) to draw: the selected range, widened to at least a year
// of months (or three years) because the data is monthly.
function poolPeriods() {
  const P = state.data.pools;
  const year = state.pools.grain === "year";
  let idx = P.dates.map((_, i) => i);
  if (year) idx = idx.filter((i) => i === P.dates.length - 1 || P.dates[i + 1].slice(0, 4) !== P.dates[i].slice(0, 4));
  const b = rangeBounds();
  let shown = idx.filter((i) => P.dates[i] <= b.end && (year ? P.dates[i].slice(0, 4) >= b.start.slice(0, 4) : inRange(P.dates[i], b)));
  const min = year ? 3 : 12;
  const widened = shown.length < min;
  if (widened) shown = idx.filter((i) => P.dates[i] <= b.end).slice(-min);
  return { P, shown, widened, year };
}

function renderPools(t) {
  const d = state.data;
  if (!d.pools) {
    $("#pools").hidden = true;
    return;
  }
  const { P, shown, widened, year } = poolPeriods();
  const { scale } = state.pools;
  document.querySelectorAll("#pools-grain button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.grain === state.pools.grain)));
  document.querySelectorAll("#pools-scale button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.scale === scale)));
  const groups = Object.keys(P.values);
  const lastIdx = P.dates.length - 1;
  // Still in progress: the latest month if more trading days are to come, and the latest
  // year until its December is complete.
  const yearOpen = P.partial || P.dates[lastIdx].slice(5, 7) !== "12";
  const partial = (i) => (year ? i === lastIdx && yearOpen : i === lastIdx && P.partial);
  const val = (g, i) => (P.values[g][i] == null ? null : P.values[g][i] * deflator(P.dates[i]));
  const totals = shown.map((i) => groups.reduce((acc, g) => acc + (val(g, i) || 0), 0));
  const label = (i) => (year ? P.dates[i].slice(0, 4) : fmtMonth(P.dates[i]));

  // Headline: the latest split, and how much the total has grown over the bars shown.
  const li = shown[shown.length - 1];
  const lt = totals[totals.length - 1];
  const split = groups.map((g) => [g, val(g, li) || 0]).sort((x, z) => z[1] - x[1]);
  const growth = totals.length > 1 && totals[0] > 0 ? lt / totals[0] - 1 : null;
  $("#pools-headline").textContent = `About ${fmtPool(lt)} in ${label(li)}${partial(li) ? " so far" : ""}: ${listText(split.slice(0, 3).map(([g, v]) => `${poolName(g).toLowerCase()} ${Math.round((v / lt) * 100)}%`))}`;
  $("#pools-sub").textContent = `${growth != null ? `${fmtPct(growth, 0)} since ${label(shown[0])}. ` : ""}${widened ? (year ? "Showing three years, since this chart is yearly. " : "Showing the last 12 months, since this chart is monthly. ") : ""}Estimates from public data; tap a bar for the split.${dollarsNote()}`;
  $("#pools-sub").appendChild(infoButton("How these sizes are estimated", "pools"));

  const c = chart("chart-pools");
  const many = shown.length > 24;
  const bottom = Math.max(1, Math.min(...shown.map((i) => val(groups[0], i)).filter((v) => v > 0)));
  c.setOption({
    grid: { left: 8, right: 8, top: 12, bottom: 24, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: t.wash } },
      formatter: (ps) => {
        const j = ps[0].dataIndex;
        const i = shown[j];
        const rows = groups.map((g) => [g, val(g, i) || 0]).sort((x, z) => z[1] - x[1]);
        return `<div style="margin-bottom:6px">${esc(label(i))}${partial(i) ? " · in progress" : ""}</div>` +
          rows.map(([g, v]) => row(poolName(g), `${fmtPool(v)} · ${Math.round((v / totals[j]) * 100)}%`, poolColor(t, g))).join("") +
          `<div style="border-top:1px solid ${t.grid};margin-top:6px;padding-top:6px">${row("Total", fmtPool(totals[j]))}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: shown.map((i) => P.dates[i]),
      ...axisStyle(t),
      axisTick: { show: false },
      axisLabel: {
        color: t.muted, fontSize: 11, hideOverlap: true,
        interval: year || !many ? 0 : (k, v) => v.slice(5, 7) === "01",
        formatter: (v) => (year || many ? v.slice(0, 4) : fmtMonth(v).replace(/ (\d{2})(\d{2})$/, " ’$2")),
      },
    },
    yAxis: scale === "share"
      ? { type: "value", max: 100, interval: 25, ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => `${v}%` } }
      : scale === "log"
        // Doublings fitted to the data, so growth reads as steps up the axis.
        // In trillions so the steps land on round numbers ($16T, $32T, $64T, ...).
        ? { type: "log", logBase: 2, min: 2 ** Math.floor(Math.log2(bottom / 1000)), max: 2 ** Math.ceil(Math.log2(Math.max(...totals) / 1000)), ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => fmtPool(v * 1000) } }
        : { type: "value", ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: fmtPool } },
    series: groups.map((g) => ({
      name: poolName(g),
      type: "bar",
      stack: "all",
      barCategoryGap: shown.length > 40 ? "10%" : "22%",
      itemStyle: { color: poolColor(t, g) },
      data: shown.map((i, j) => {
        const v = val(g, i);
        const y = v == null ? null : scale === "share" ? (v / totals[j]) * 100 : scale === "log" ? v / 1000 : v;
        return partial(i) ? { value: y, itemStyle: { color: poolColor(t, g), decal: STRIPES } } : y;
      }),
    })),
  }, true);
  $("#pools-legend").replaceChildren(...groups.map((g) => {
    const sp = document.createElement("span");
    const key = document.createElement("i");
    key.style.background = poolColor(t, g);
    sp.append(key, document.createTextNode(poolName(g)));
    return sp;
  }));
  table(cardTable("pools"), [year ? "Year" : "Month", ...groups.map(poolName), "Total"],
    shown.map((i, j) => [label(i), ...groups.map((g) => fmtPool(val(g, i))), fmtPool(totals[j])]).reverse());
}

// ---------- money map: every fund as a tile, sized by assets, coloured by flow ----------

function mixHex(a, b, k) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

function renderMap(t) {
  const w = aggregate();
  const funds = Object.entries(w.assets).filter(([, a]) => a.aum_bn > 0 && a.intensity != null);
  const sizes = funds.map(([, a]) => Math.abs(a.intensity)).sort((x, z) => x - z);
  // Colour saturates at the 90th percentile of this range's flows, so one outlier can't wash out the rest.
  const cap = sizes.length ? Math.max(0.002, sizes[Math.floor((sizes.length - 1) * 0.9)]) : 0.01;
  const shade = (v) => Math.min(1, Math.abs(v) / cap);
  const colour = (v) => mixHex(t.mid, v >= 0 ? t.pos : t.neg, 0.15 + 0.85 * shade(v));
  $("#map-sub").textContent = `${fmtRange(w.start, w.end)}. Each tile is a fund, sized by its assets. Blue means money came in, red money went out, as a share of the fund; the stronger the colour, the bigger the flow.`;
  $("#map-sub").appendChild(infoButton("Flow as a share of each fund", "intensity"));
  const data = state.data.groups.filter((g) => g !== SIDELINES).map((g) => ({
    name: g,
    children: funds.filter(([tk]) => state.assets[tk].group === g).map(([tk, a]) => ({
      name: shortName(tk), tk, value: a.aum_bn, a,
      itemStyle: { color: colour(a.intensity) },
      label: { color: shade(a.intensity) > 0.55 ? "#ffffff" : t.text },
    })),
  })).filter((g) => g.children.length);
  const c = chart("chart-map");
  c.setOption({
    tooltip: {
      ...tooltipBase(t),
      formatter: (p) => {
        const a = p.data && p.data.a;
        if (!a) return `<div>${esc(p.name)}</div>`;
        return `<div style="margin-bottom:4px">${esc(assetName(p.data.tk))}</div>` +
          row("Net flow", fmtUsdBn(a.net_flow_bn, true)) +
          row("Share of fund", fmtPct(a.intensity, 1)) +
          row("Fund size", fmtUsdBn(a.aum_bn)) +
          row("Return", fmtPct(a.ret));
      },
    },
    series: [{
      type: "treemap",
      data,
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      top: 0, left: 0, right: 0, bottom: 0,
      label: { show: true, fontSize: 12, overflow: "truncate", formatter: (p) => (p.data.a ? `${p.name}\n${fmtPct(p.data.a.intensity, 1)}` : p.name) },
      upperLabel: { show: true, height: 22, color: t.text2, fontSize: 12, fontWeight: 600 },
      levels: [
        { itemStyle: { borderColor: t.surface, borderWidth: 0, gapWidth: 3 } },
        { itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2, color: t.surface }, upperLabel: { show: true } },
        { itemStyle: { borderColor: t.surface, borderWidth: 1, gapWidth: 1 } },
      ],
    }],
  }, true);
  c.off("click");
  c.on("click", (p) => { if (p.data && p.data.tk) openCloseup(p.data.tk); });
  // Legend: the colour scale, from money out to money in.
  const legend = $("#map-legend");
  legend.replaceChildren();
  const bar = document.createElement("span");
  bar.className = "ramp";
  bar.style.background = `linear-gradient(90deg, ${t.neg}, ${t.mid}, ${t.pos})`;
  const lo = document.createElement("span");
  lo.textContent = `Money out (${fmtPct(-cap, 1)} or more)`;
  const hi = document.createElement("span");
  hi.textContent = `Money in (${fmtPct(cap, 1)} or more)`;
  legend.append(lo, bar, hi);
  table(cardTable("map"), ["Market", "Class", "Share of fund", "Net flow", "Fund size", "Return"],
    funds.slice().sort((x, z) => z[1].intensity - x[1].intensity).map(([tk, a]) => [
      assetName(tk), state.assets[tk].group, fmtPct(a.intensity, 1), fmtUsdBn(a.net_flow_bn, true), fmtUsdBn(a.aum_bn), fmtPct(a.ret),
    ]));
}

// ---------- flows vs returns ----------

// How unusual each fund's flow over the range is: where its net flow, as a share of the
// fund, ranks among every window of the same length in the last three years of daily
// data (0 = the biggest outflow, 100 = the biggest inflow). Empty for longer ranges.
function flowPercentiles(b = rangeBounds()) {
  const D = state.data.series.daily;
  const key = `${b.start}|${b.end}|${b.inclusive ? 1 : 0}`;
  if (state.pctCache && state.pctCache.key === key) return state.pctCache.value;
  const out = {};
  const idx = b.start >= D.dates[0] ? D.dates.map((d, i) => (inRange(d, b) ? i : -1)).filter((i) => i >= 0) : [];
  const n = idx.length;
  if (n && D.dates.length - n >= 60) {
    const end = idx[n - 1];
    Object.keys(D.flow).forEach((t) => {
      const f = D.flow[t];
      const a = D.aum[t];
      const sums = [0];
      f.forEach((v, i) => sums.push(sums[i] + (v || 0)));
      const share = (j) => (a[j - n + 1] > 0 && f[j] != null ? (sums[j + 1] - sums[j - n + 1]) / a[j - n + 1] : null);
      const now = share(end);
      if (now == null) return;
      const past = [];
      for (let j = n - 1; j < D.dates.length; j += 1) {
        const v = share(j);
        if (v != null) past.push(v);
      }
      if (past.length < 60) return;
      out[t] = ((past.filter((v) => v < now).length + 0.5 * past.filter((v) => v === now).length) / past.length) * 100;
    });
  }
  state.pctCache = { key, value: out };
  return out;
}

function pctText(p) {
  return p == null ? "–" : `${ordinal(p)} percentile`;
}

const QUADRANTS = [
  [1, 1, "Chasing strength", "Money going into a fund that is rising"],
  [-1, 1, "Buying the dip", "Money going into a fund that is falling"],
  [1, -1, "Taking profits", "Money leaving a fund that is rising"],
  [-1, -1, "Capitulation", "Money leaving a fund that is falling"],
];

function quadrantOf(v) {
  return QUADRANTS.find(([x, y]) => Math.sign(v.ret || 0) === x && Math.sign(v.intensity || 0) === y) || QUADRANTS[0];
}

// Flows against returns: is money chasing what rises, buying the dip, taking profits or
// capitulating? One dot per fund with real flow data, sized by the fund.
function renderQuadrant(t) {
  const w = aggregate();
  const pct = flowPercentiles();
  const rows = Object.entries(w.assets)
    .filter(([k, v]) => k !== "STABLES" && v.intensity != null && v.ret != null)
    .map(([k, v]) => ({ k, v }));
  $("#quadrant-sub").textContent = `${fmtRange(w.start, w.end)}. Each dot is a fund: across is its return, up is net money in as a share of the fund, size is the fund's size.${dollarsNote()}`;
  const c = chart("chart-quadrant");
  if (!rows.length) {
    emptyChart(c, t, "No fund flows in this range");
    table(cardTable("quadrant"), ["Market"], []);
    return;
  }
  const maxAum = Math.max(...rows.map((r) => r.v.aum_bn || 0)) || 1;
  // Phones: name only the biggest movers and the S&P 500, so labels don't pile up.
  const named = new Set(narrowScreen()
    ? ["SPY", ...rows.slice().sort((a, z) => Math.abs(z.v.intensity) - Math.abs(a.v.intensity)).slice(0, 6).map((r) => r.k)]
    : rows.map((r) => r.k));
  const size = (aum) => 8 + 34 * Math.sqrt((aum || 0) / maxAum);
  const xs = rows.map((r) => r.v.ret);
  const ys = rows.map((r) => r.v.intensity);
  // Padded so labels fit, with both ends on a round tick and zero always in view.
  const nice = (vals) => {
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const raw = (hi - lo) / (narrowScreen() ? 3 : 5) || 0.01;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw);
    const pad = (hi - lo) * 0.08;
    return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad) / step) * step, step];
  };
  const [x0, x1, xStep] = nice(xs);
  const [y0, y1, yStep] = nice(ys);
  const digits = (step) => (Math.abs(Math.round(step * 100) - step * 100) > 1e-9 ? 1 : 0);
  const corner = (text, pos) => ({ name: text, label: { show: true, position: pos, color: t.muted, fontSize: 11, formatter: text } });
  c.setOption({
    grid: { left: 8, right: 16, top: 16, bottom: 28, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p) => {
        if (p.componentType !== "series") return "";
        const r = rows[p.dataIndex];
        return `<div style="margin-bottom:4px">${esc(assetName(r.k))}</div>` +
          row("Return", fmtPct(r.v.ret)) +
          row("Net flow", fmtUsdBn(r.v.net_flow_bn, true)) +
          row("Share of fund", fmtPct(r.v.intensity, 1)) +
          (pct[r.k] != null ? row("How unusual", pctText(pct[r.k])) : "") +
          row("Fund size", fmtUsdBn(r.v.aum_bn)) +
          `<div style="margin-top:6px;opacity:.7">${esc(quadrantOf(r.v)[2])}</div>`;
      },
    },
    xAxis: { type: "value", min: x0, max: x1, interval: xStep, ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => fmtPct(v, digits(xStep)) } },
    yAxis: { type: "value", min: y0, max: y1, interval: yStep, ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => fmtPct(v, digits(yStep)) } },
    series: [{
      type: "scatter",
      data: rows.map((r) => ({
        value: [r.v.ret, r.v.intensity],
        symbolSize: size(r.v.aum_bn),
        itemStyle: { color: assetColor(r.k, t), opacity: 0.85, borderColor: t.surface, borderWidth: 1 },
        label: { show: named.has(r.k), position: "right", color: t.text2, fontSize: 11, formatter: () => shortName(r.k) },
      })),
      labelLayout: { hideOverlap: true },
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid", width: 1 }, label: { show: false }, data: [{ xAxis: 0 }, { yAxis: 0 }] },
      markArea: {
        silent: true,
        itemStyle: { color: "transparent" },
        data: [
          [{ ...corner("Chasing strength", "insideTopRight"), coord: [0, 0] }, { coord: [x1, y1] }],
          [{ ...corner("Buying the dip", "insideTopLeft"), coord: [x0, 0] }, { coord: [0, y1] }],
          [{ ...corner("Taking profits", "insideBottomRight"), coord: [0, y0] }, { coord: [x1, 0] }],
          [{ ...corner("Capitulation", "insideBottomLeft"), coord: [x0, y0] }, { coord: [0, 0] }],
        ],
      },
    }],
  }, true);
  c.off("click");
  c.on("click", (p) => { if (p.componentType === "series") openCloseup(rows[p.dataIndex].k); });
  table(cardTable("quadrant"), ["Market", "Return", "Net flow", "Share of fund", "How unusual", "Reading"],
    rows.slice().sort((a, z) => z.v.intensity - a.v.intensity).map((r) => [
      assetName(r.k), fmtPct(r.v.ret), fmtUsdBn(r.v.net_flow_bn, true), fmtPct(r.v.intensity, 1), pctText(pct[r.k]), quadrantOf(r.v)[2],
    ]));
}

// Horizontal bar value axis: padded so end labels have room, with a tick step chosen
// from the data so phones get three or four ticks instead of a crowded row.
function barValueAxis(t, values, fmt) {
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
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: fmt || ((v) => fmtPct(v, digits)) },
  };
}

// Bar value labels: outside the bar end, except long negative bars, where the label sits
// inside the bar (white on the fill) so it can't run into the category names.
function barLabel(t, values, digits, fmt) {
  const maxAbs = Math.max(...values.map(Math.abs)) || 1;
  return (v) => {
    const inside = v < 0 && Math.abs(v) / maxAbs > 0.45;
    return {
      show: true,
      position: inside ? "insideLeft" : v < 0 ? "left" : "right",
      color: inside ? "#ffffff" : t.text2,
      fontSize: 11,
      formatter: () => (fmt ? fmt(v) : fmtPct(v, digits)),
    };
  };
}

function barGrid() {
  return { left: 8, right: 48, top: 8, bottom: 28, containLabel: true };
}

function barCategoryName(ticker) {
  return narrowScreen() ? shortName(ticker) : assetName(ticker);
}

// ---------- liquidity history ----------

state.history = { kind: "weekly" };

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
  const { kind } = state.history;
  const h = historyData(kind);
  const groups = state.data.groups;
  const color = (g) => groupColor(t, g);
  document.querySelectorAll("#history-kind button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.kind === kind));
    b.disabled = !grainAvailable(b.dataset.kind);
  });

  const c = chart("chart-history");
  if (!h.end.length) {
    c.clear();
    $("#history-headline").textContent = "No flow history in this range";
    $("#history-sub").textContent = "Flow history starts in January 2017. Pick a later or longer range.";
    table(cardTable("history"), ["Period"], []);
    return;
  }
  const unit = { daily: "day", weekly: "week", monthly: "month" }[kind];
  $("#history-headline").textContent = "Running total by class";
  $("#history-sub").textContent = `How much each class has taken in (above zero) or lost (below zero) since ${fmtDate(h.start[0], true)}, ${unit} by ${unit}. Shaded bands are S&P 500 selloffs.${dollarsNote()}`;

  const running = (arr) => { let acc = 0; return arr.map((v) => (acc += v || 0)); };
  // The sidelines would only mirror every other line, so they show as net new money
  // into the tracked funds instead (their balance with the sign flipped).
  const NEW_MONEY = "Net new money";
  const totals = Object.fromEntries(groups.map((g) => [g, running(g === SIDELINES ? h.net[g].map((v) => -v) : h.net[g])]));
  const showSymbol = h.end.length <= 12;
  const series = groups.map((g, gi) => ({
    name: g === SIDELINES ? NEW_MONEY : g,
    type: "line", showSymbol, symbolSize: 5,
    data: h.end.map((d, i) => [d, Math.round(totals[g][i] * 100) / 100]),
    lineStyle: { width: g === SIDELINES ? 1.5 : 2, color: g === SIDELINES ? t.text2 : color(g) },
    itemStyle: { color: g === SIDELINES ? t.text2 : color(g) },
    z: g === SIDELINES ? 5 : 2,
    emphasis: { focus: "series" },
    markArea: gi === 0 ? selloffBands(t) : undefined,
    endLabel: { show: !narrowScreen(), formatter: "{a}", color: t.text2, fontSize: 11 },
    labelLayout: { moveOverlap: "shiftY" },
  }));
  const periodText = (i) => (h.start[i] === h.end[i] ? fmtDate(h.end[i], true) : fmtRange(h.start[i], h.end[i]));

  c.setOption({
    grid: { left: 8, right: narrowScreen() ? 16 : 130, top: narrowScreen() ? 64 : 40, bottom: 24, containLabel: true },
    legend: {
      top: 0, left: 0, textStyle: { color: t.text2, fontSize: 12 }, inactiveColor: t.grid,
      icon: "path://M0,0 L12,0 L12,2 L0,2 Z", itemWidth: 12, itemHeight: 2,
    },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.axis } },
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        const head = `<div style="margin-bottom:4px">${esc(fmtRange(h.start[0], h.end[i]))}</div>`;
        const rows = ps.slice().sort((a, b) => b.data[1] - a.data[1]).map((p) => row(p.seriesName, fmtUsdBn(p.data[1], true), p.color)).join("");
        return head + rows + `<div style="margin-top:6px;opacity:.7">Tap to see ${esc(periodText(i))} by class</div>`;
      },
    },
    xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true } },
    yAxis: { type: "value", ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: fmtAxisUsd } },
    series,
  }, true);
  // Clicking anywhere in the plot (on a line, a selloff band or empty space) replays the nearest period.
  c.getZr().off("click");
  c.getZr().on("click", (ev) => {
    const pt = [ev.offsetX, ev.offsetY];
    if (!c.containPixel("grid", pt)) return;
    const x = c.convertFromPixel({ seriesIndex: 0 }, pt)[0];
    const ends = h.end.map((d) => parseDay(d).getTime());
    let best = 0;
    ends.forEach((e, i) => { if (Math.abs(e - x) < Math.abs(ends[best] - x)) best = i; });
    replay(historyView(kind, h.idx[best]));
  });

  const classes = groups.filter((g) => g !== SIDELINES);
  table(cardTable("history"), ["Through", ...classes, NEW_MONEY],
    h.end.map((d, i) => [fmtDate(d, true), ...[...classes, SIDELINES].map((g) => fmtUsdBn(totals[g][i], true))]).reverse());
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

state.closeupOpen = false;

// The close-up opens as a pop-up over the page from any fund name or bar.
function openCloseup(ticker) {
  if (!state.assets[ticker]) return;
  state.market = ticker;
  const dlg = $("#closeup-dialog");
  if (!dlg.open) {
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute("open", "");
  }
  state.closeupOpen = true;
  hideTip();
  safely("market close-up", renderCloseup, theme());
  if (state.charts["chart-closeup"]) state.charts["chart-closeup"].resize();
  writeHash();
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
  const playbook = computePlaybook(shown.eps);
  const rows = playbook.slice().reverse();
  const vals = rows.map((r) => r.median_ret);
  const playbookLabel = barLabel(t, vals, 1);
  // Tall enough that every market gets its own readable row.
  $("#chart-playbook").style.height = `${Math.max(320, rows.length * 22 + 50)}px`;
  const c = chart("chart-playbook");
  c.resize();
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

// The selloff section's lede and the line above the tabs: how often, how deep, and now.
function renderSelloffStats() {
  const d = state.data;
  const s = d.selloffs;
  const pct = `${Math.round(s.threshold * 100)}%`;
  $("#threshold-text").textContent = pct;
  const shown = selloffsShown();
  const n = shown.eps.filter((e) => !e.ongoing).length;
  $("#selloff-sub").textContent = shown.all
    ? `No completed selloff ${rangeSpan()}, so this shows all ${n} since ${fmtMonth(shown.eps[0].peak)}. What rose while stocks fell is where sellers' money went.`
    : `${n} completed selloff${n === 1 ? "" : "s"} ${rangeSpan()}. What rose while stocks fell is where sellers' money went.`;
  const done = s.episodes.filter((e) => !e.ongoing);
  if (!done.length) {
    $("#selloff-stats").textContent = "";
    return;
  }
  const years = (parseDay(d.meta.as_of) - parseDay(s.episodes[0].peak)) / (365.25 * 864e5);
  const last = s.episodes[s.episodes.length - 1];
  const now = last && last.ongoing
    ? `A selloff is under way: ${fmtPct(last.drawdown, 1)} since ${fmtDate(last.peak)}.`
    : `Today the S&P 500 is ${fmtPct(d.kpis.drawdown, 1)} from its high.`;
  $("#selloff-stats").textContent = `Since 2016 the S&P 500 has fallen ${pct} or more ${done.length} times, about once every ${Math.round((years * 12) / done.length)} months. ` +
    `The typical drop was ${fmtPct(median(done.map((e) => e.drawdown)), 0)} over ${Math.round(median(done.map((e) => e.days)) / 5)} weeks. ${now}`;
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
  const cashKeys = [["stablecoins", "Stablecoins"], ["mmf_total", "All MMF"], ["retail_mmf", "Retail MMF"], ["rrp", "Reverse repo"], ["net_liquidity", "Net liquidity"]];
  table(cardTable("heatmap"),
    ["Selloff", "S&P 500", ...tickers.filter((tk) => tk !== "SPY").map(shortName), ...cashKeys.map((c) => `Δ ${c[1]}`)],
    eps.map((e) => [
      `${fmtRange(e.peak, e.trough)}${e.ongoing ? " (ongoing)" : ""}`,
      fmtPct(e.drawdown),
      ...tickers.filter((tk) => tk !== "SPY").map((tk) => fmtPct(e.assets[tk] && e.assets[tk].ret)),
      ...cashKeys.map(([k]) => fmtUsdBn(e.cash[k], true)),
    ]));
}

// ---------- cash buckets ----------

const CASH_PANELS = [
  { key: "stablecoins", title: "Stablecoin supply", note: "Crypto's cash pile" },
  { key: "mmf_total", title: "All money market funds", note: "Households and companies" },
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

// Estimated net flows into all money market funds for the months that mostly fall
// inside [start, end]; null when no reported month does.
function mmfFlowFor(start, end) {
  const f = state.data.mmf_flows;
  if (!f || !f.length) return null;
  const months = f.filter(([d]) => d >= shiftDate(start, 15) && d <= shiftDate(end, 15));
  if (!months.length) return null;
  return {
    value: months.reduce((a, [d, v]) => a + v * deflator(d), 0),
    from: months[0][0],
    to: months[months.length - 1][0],
  };
}

function monthSpan(from, to) {
  return from === to ? fmtMonth(to) : `${fmtMonth(from)} – ${fmtMonth(to)}`;
}

// One line under the wheel tying its sidelines to measured cash: what money funds took in.
function mmfNote(view) {
  const f = state.data.mmf_flows;
  if (!f || !f.length) return "";
  const m = mmfFlowFor(view.start, view.end);
  if (m) {
    return `Measured cash for comparison: money market funds ${m.value >= 0 ? "took in" : "lost"} ${fmtUsdBn(Math.abs(m.value))} in ${monthSpan(m.from, m.to)} (estimated, after interest).`;
  }
  // A short period in the past: use the reported months it overlaps.
  const [d, v] = f[f.length - 1];
  if (view.end <= d) {
    const months = f.filter(([x]) => x >= view.start && shiftDate(x, -31) < view.end);
    if (months.length) {
      const total = months.reduce((a, [x, y]) => a + y * deflator(x), 0);
      return `Measured cash for comparison: money market funds ${total >= 0 ? "took in" : "lost"} ${fmtUsdBn(Math.abs(total))} in ${monthSpan(months[0][0], months[months.length - 1][0])}, the month${months.length > 1 ? "s" : ""} this period falls in (estimated, after interest).`;
    }
  }
  return `Measured cash for comparison: money market funds ${v >= 0 ? "took in" : "lost"} ${fmtUsdBn(Math.abs(v * deflator(d)))} in ${fmtMonth(d)}, the latest month reported.`;
}

function shiftDate(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- rates and credit ----------

const RATE_NOTES = {
  DTB3: "What cash earns",
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

function renderPositionHistory(t) {
  const list = state.data.positioning || [];
  const p = list.find((x) => x.key === state.backdrop.positioning) || list[0];
  if (!p) return;
  $("#positions-title").textContent = `Net position: ${p.name}`;
  // Weekly reports: widen short ranges to the last few months so there is a line to read.
  const b = rangeBounds();
  let idx = p.dates.map((d, i) => (inRange(d, b) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 8) {
    const last = p.dates.map((d, i) => (d <= b.end ? i : -1)).filter((i) => i >= 0);
    idx = last.slice(-13);
  }
  $("#positions-sub").textContent = `Contracts long minus contracts short, weekly.${idx.length && !inRange(p.dates[idx[0]], b) ? " Shown for the last three months, since the range holds few weekly reports." : ""}`;
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
}

// ---------- backdrop: compact tables with sparklines, one detail chart per tab ----------

state.backdrop = { cash: "mmf_total", rates: "DGS10", positioning: null, risk: "regime" };

// A tiny trend line for a table cell.
function sparkline(points, color) {
  const ns = "http://www.w3.org/2000/svg";
  const W = 84;
  const H = 24;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  const pts = points.filter((p) => p[1] != null);
  if (pts.length < 2) return svg;
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals);
  const span = Math.max(...vals) - lo || 1;
  const xy = pts.map((p, i) => [2 + (i / (pts.length - 1)) * (W - 4), H - 2 - ((p[1] - lo) / span) * (H - 4)]);
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "1.5");
  const dot = document.createElementNS(ns, "circle");
  const [x, y] = xy[xy.length - 1];
  dot.setAttribute("cx", x);
  dot.setAttribute("cy", y);
  dot.setAttribute("r", "2");
  dot.setAttribute("fill", color);
  svg.append(line, dot);
  return svg;
}

function nameCell(name, note, info) {
  const wrap = document.createElement("span");
  wrap.className = "bd-name";
  const top = document.createElement("span");
  top.className = "bd-top";
  top.textContent = name;
  if (info && INFO[info]) top.appendChild(infoButton(name, info));
  wrap.appendChild(top);
  if (note) {
    const sm = document.createElement("span");
    sm.className = "bd-note";
    sm.textContent = note;
    wrap.appendChild(sm);
  }
  return wrap;
}

// A selectable table: each row is a series; picking one draws its chart below.
function backdropTable(panel, title, columns, rows, onSelect) {
  const box = $(`#bd-${panel}`);
  const tbl = document.createElement("table");
  const head = tbl.createTHead().insertRow();
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.head;
    if (col.cls) th.className = col.cls;
    head.appendChild(th);
  });
  const body = tbl.createTBody();
  rows.forEach((r) => {
    const tr = body.insertRow();
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(r.key === state.backdrop[panel]));
    columns.forEach((col) => {
      const td = tr.insertCell();
      if (col.cls) td.className = col.cls;
      const v = col.cell(r);
      if (v instanceof Node) td.appendChild(v);
      else td.textContent = v;
    });
    const pick = () => {
      state.backdrop[panel] = r.key;
      body.querySelectorAll("tr").forEach((x) => x.setAttribute("aria-selected", String(x === tr)));
      onSelect(r);
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
  });
  const csv = csvButton(title, columns.map((c) => c.head).filter(Boolean),
    rows.map((r) => columns.filter((c) => c.head).map((c) => (c.csv ? c.csv(r) : c.cell(r)))));
  box.replaceChildren(tbl, csv);
}

// One line chart (or bars) for the selected row, with selloffs shaded.
function detailChart(t, id, { name, pts, fmt, axisFmt, type = "line", lines = [], yMin, yMax }) {
  chart(id).setOption({
    grid: { left: 8, right: 56, top: 16, bottom: 24, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: type === "bar" ? "shadow" : "line", lineStyle: { color: t.axis } },
      formatter: (ps) => `<div style="margin-bottom:4px">${esc(fmtDate(ps[0].data[0]))}</div>` + row(name, fmt(ps[0].data[1]), t.groups[0]),
    },
    xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true } },
    yAxis: { type: "value", scale: yMin == null, min: yMin, max: yMax, splitNumber: 4, ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: axisFmt } },
    series: [{
      type,
      data: pts,
      showSymbol: false,
      barMaxWidth: 16,
      lineStyle: { width: 2, color: t.groups[0] },
      itemStyle: type === "bar" ? { color: (p) => (p.value[1] >= 0 ? t.pos : t.neg) } : { color: t.groups[0] },
      markArea: selloffBands(t),
      markLine: lines.length
        ? { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid", width: 1 }, label: { color: t.muted, fontSize: 11, position: "end", formatter: (p) => p.name || "" }, data: lines }
        : undefined,
    }],
  }, true);
}

function changeHead() {
  return `Change, ${rangeShort()}`;
}

// Value, change over the range (or the latest report for slow series) and recent points.
function seriesSummary(pts) {
  const b = rangeBounds();
  const [value, change] = changeOverRange(pts, b);
  let latest = null;
  if (change == null) {
    const upto = pts.filter((x) => x[0] <= b.end);
    if (upto.length >= 2) latest = { chg: upto[upto.length - 1][1] - upto[upto.length - 2][1], when: upto[upto.length - 1][0] };
  }
  return { value, change, latest, pts: cashChartPoints(pts, b) };
}

function renderBackdropCash(t) {
  const d = state.data;
  const rows = CASH_PANELS.filter((p) => d.cash[p.key]).map((p) => ({ key: p.key, name: p.title, note: p.note, info: p.key, ...seriesSummary(realPoints(d.cash[p.key])) }));
  if (d.mmf_flows && d.mmf_flows.length) {
    const b = rangeBounds();
    const m = mmfFlowFor(b.start, b.end);
    const last = d.mmf_flows[d.mmf_flows.length - 1];
    const months = d.mmf_flows.filter(([x]) => x <= shiftDate(b.end, 15));
    rows.splice(1, 0, {
      key: "mmf_flows", name: "Money fund net flows", note: "Estimated, after interest", bars: true,
      value: m ? m.value : last[1] * deflator(last[0]),
      valueNote: m ? monthSpan(m.from, m.to) : fmtMonth(last[0]),
      change: null, latest: null,
      pts: months.filter(([x]) => x >= shiftDate(b.start, 15)).length >= 6 ? months.filter(([x]) => x >= shiftDate(b.start, 15)).map(([x, v]) => [x, v * deflator(x)]) : months.slice(-12).map(([x, v]) => [x, v * deflator(x)]),
    });
  }
  const changeText = (r) => (r.key === "mmf_flows" ? r.valueNote
    : r.change != null ? fmtUsdBn(r.change, true) : r.latest ? `${fmtUsdBn(r.latest.chg, true)} (${fmtMonth(r.latest.when)})` : "–");
  const draw = (r) => {
    $("#bd-cash-title").textContent = `${r.name}${r.key === "mmf_flows" ? ", by month" : ""}${dollarsNote()}`;
    detailChart(t, "chart-bd-cash", { name: r.name, pts: r.pts, fmt: (v) => fmtUsdBn(v, r.bars), axisFmt: fmtAxisUsd, type: r.bars ? "bar" : "line", lines: r.bars ? [{ yAxis: 0 }] : [] });
  };
  backdropTable("cash", "Cash on the sidelines", [
    { head: "Where cash sits", cell: (r) => nameCell(r.name, r.note, r.info), csv: (r) => r.name },
    { head: "Latest", cls: "num", cell: (r) => fmtUsdBn(r.value, r.bars) },
    { head: changeHead(), cls: "num", cell: changeText },
    { head: "", cls: "spark-cell hide-narrow", cell: (r) => sparkline(r.pts, t.groups[0]) },
  ], rows, draw);
  draw(rows.find((r) => r.key === state.backdrop.cash) || rows[0]);
}

function renderBackdropRates(t) {
  const rates = state.data.rates || {};
  const rows = Object.keys(RATE_NOTES).filter((k) => rates[k]).map((k) => ({ key: k, name: rates[k].name, note: RATE_NOTES[k], unit: rates[k].unit, ...seriesSummary(rates[k].points) }));
  if (!rows.length) return;
  const draw = (r) => {
    $("#bd-rates-title").textContent = r.name;
    const vals = r.pts.map((p) => p[1]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const digits = hi - lo < 0.05 ? 3 : hi - lo < 0.3 ? 2 : 1;
    detailChart(t, "chart-bd-rates", {
      name: r.name, pts: r.pts, fmt: (v) => fmtRate(v, r.unit),
      axisFmt: (v) => (r.unit === "pct" ? `${fmtNum(v, digits)}%` : fmtNum(v, digits)),
      lines: lo < 0 && hi > 0 ? [{ yAxis: 0 }] : [],
    });
  };
  backdropTable("rates", "Rates and credit", [
    { head: "Rate", cell: (r) => nameCell(r.name, r.note), csv: (r) => r.name },
    { head: "Latest", cls: "num", cell: (r) => fmtRate(r.value, r.unit) },
    { head: changeHead(), cls: "num", cell: (r) => (r.change != null ? fmtRateChange(r.change, r.unit) : "–") },
    { head: "", cls: "spark-cell hide-narrow", cell: (r) => sparkline(r.pts, t.groups[1]) },
  ], rows, draw);
  draw(rows.find((r) => r.key === state.backdrop.rates) || rows[0]);
}

// A 0 to 100 track with a marker at the percentile.
function percentileBar(pct, t) {
  const wrap = document.createElement("span");
  wrap.className = "pct-bar";
  const track = document.createElement("span");
  track.className = "track";
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.style.left = `${Math.max(0, Math.min(100, pct))}%`;
  mark.style.background = pct >= 85 ? t.pos : pct <= 15 ? t.neg : t.muted;
  track.appendChild(mark);
  const label = document.createElement("span");
  label.className = "pct-label";
  label.textContent = ordinal(pct);
  wrap.append(track, label);
  return wrap;
}

function renderBackdropPositioning(t) {
  const list = state.data.positioning || [];
  if (!list.length) return;
  const b = rangeBounds();
  const rows = list.map((p) => ({ key: p.key, p, c: crowding(p, b) })).filter((r) => r.c)
    .sort((x, z) => Math.abs(z.c.pct - 50) - Math.abs(x.c.pct - 50));
  if (!rows.length) return;
  if (!rows.some((r) => r.key === state.backdrop.positioning)) state.backdrop.positioning = rows[0].key;
  const asOf = rows.reduce((m, r) => (r.c.date > m ? r.c.date : m), "");
  $("#positioning-sub").textContent = `Speculators' net futures position on ${fmtDate(asOf)} as a percentile of the three years before it (CFTC, weekly). Near 0 or 100 is crowded and can unwind fast.`;
  backdropTable("positioning", "Futures positioning", [
    { head: "Futures", cell: (r) => nameCell(r.p.name.replace(" futures", ""), r.p.who), csv: (r) => r.p.name },
    { head: "Net contracts", cls: "num hide-narrow", cell: (r) => fmtContracts(r.c.net) },
    { head: "Week", cls: "num hide-narrow", cell: (r) => fmtContracts(r.c.change) },
    { head: "Percentile, 3 years", cls: "pct-cell", cell: (r) => percentileBar(r.c.pct, t), csv: (r) => ordinal(r.c.pct) },
    { head: "Reading", cls: "hide-narrow", cell: (r) => crowdLabel(r.c.pct, r.c.net) },
  ], rows, () => renderPositionHistory(theme()));
  renderPositionHistory(t);
}

function renderBackdropRisk(t) {
  const d = state.data;
  const b = rangeBounds();
  const all = d.correlations;
  const src = all.daily && b.start >= all.daily.dates[0] ? all.daily : all;
  const corr = (tk) => src.dates.map((x, i) => [x, src.series[tk][i]]).filter((p) => p[1] != null);
  const rows = [{ key: "regime", name: "Risk appetite score", note: "Above +0.5 risk-on, below −0.5 risk-off", info: "regime", ...seriesSummary(d.regime.history) }];
  Object.keys(src.series).forEach((tk) => rows.push({ key: tk, name: `${shortName(tk)} vs stocks`, note: "60-day correlation with the S&P 500", corr: true, ...seriesSummary(corr(tk)) }));
  const draw = (r) => {
    $("#bd-risk-title").textContent = r.key === "regime" ? "Risk appetite score" : `${assetName(r.key)}: correlation with the S&P 500`;
    $("#regime-components").hidden = r.key !== "regime";
    if (r.corr) {
      detailChart(t, "chart-bd-risk", { name: r.name, pts: r.pts, fmt: (v) => fmtNum(v, 2, true), axisFmt: (v) => fmtNum(v, 1, true), yMin: -1, yMax: 1, lines: [{ yAxis: 0 }] });
    } else {
      detailChart(t, "chart-bd-risk", { name: r.name, pts: r.pts, fmt: (v) => fmtNum(v, 2, true), axisFmt: (v) => fmtNum(v, 1, true), lines: [{ yAxis: 0.5, name: "Risk-on" }, { yAxis: -0.5, name: "Risk-off" }] });
    }
  };
  backdropTable("risk", "Risk and relationships", [
    { head: "Measure", cell: (r) => nameCell(r.name, r.note, r.info), csv: (r) => r.name },
    { head: "Latest", cls: "num", cell: (r) => (r.key === "regime" ? `${fmtNum(r.value, 2, true)} ${r.value >= 0.5 ? "on" : r.value <= -0.5 ? "off" : ""}`.trim() : fmtNum(r.value, 2, true)) },
    { head: changeHead(), cls: "num", cell: (r) => fmtNum(r.change, 2, true) },
    { head: "", cls: "spark-cell hide-narrow", cell: (r) => sparkline(r.pts, r.corr ? assetColor(r.key, t) : t.groups[0]) },
  ], rows, draw);
  // The score's ingredients, as of the latest reading.
  const ul = $("#regime-components");
  ul.replaceChildren();
  Object.entries(d.regime.components).forEach(([name, z]) => {
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
  draw(rows.find((r) => r.key === state.backdrop.risk) || rows[0]);
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

// ---------- tabs: each card draws only the view that is showing ----------

state.tabs = { flows: "classes", selloffs: "playbook", backdrop: "cash" };
const TAB_DEFAULTS = { ...state.tabs };
const TAB_RENDERERS = {
  classes: ["classes", () => renderClasses],
  map: ["money map", () => renderMap],
  quadrant: ["flows vs returns", () => renderQuadrant],
  playbook: ["selloff playbook", () => renderPlaybook],
  heatmap: ["selloff heatmap", () => renderHeatmap],
  cash: ["cash", () => renderBackdropCash],
  rates: ["rates", () => renderBackdropRates],
  positioning: ["positioning", () => renderBackdropPositioning],
  risk: ["risk", () => renderBackdropRisk],
};

function renderTab(tab) {
  const [name, fn] = TAB_RENDERERS[tab];
  safely(name, fn(), theme());
  document.querySelectorAll(`[data-panel="${tab}"] .chart`).forEach((el) => { if (state.charts[el.id]) state.charts[el.id].resize(); });
}

function showTab(group, tab, { render = true, hash = true } = {}) {
  const card = document.querySelector(`[data-tabs="${group}"]`);
  if (!card || !TAB_RENDERERS[tab]) return;
  state.tabs[group] = tab;
  card.querySelectorAll('[role="tab"]').forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
  });
  card.querySelectorAll(":scope > .panel").forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
  if (render) renderTab(tab);
  if (hash) writeHash();
}

function renderAll() {
  const t = theme();
  syncRangeControls();
  Object.values(state.tabs).forEach(renderTab);
  safely("liquidity history", renderHistory, t);
  safely("where the money sits", renderPools, t);
  safely("selloff summary", renderSelloffStats);
  if (state.closeupOpen) safely("market close-up", renderCloseup, t);
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
// (#range=3M&r=ep:12&m=GLD&hk=monthly, or from=…&to=… for a custom range).
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
  if (state.closeupOpen) params.set("m", state.market);
  if (state.tabs.flows !== TAB_DEFAULTS.flows) params.set("f", state.tabs.flows);
  if (state.tabs.selloffs !== TAB_DEFAULTS.selloffs) params.set("s", state.tabs.selloffs);
  if (state.tabs.backdrop !== TAB_DEFAULTS.backdrop) params.set("b", state.tabs.backdrop);
  if (state.pools.grain !== "month") params.set("pg", state.pools.grain);
  if (state.pools.scale !== "linear") params.set("ps", state.pools.scale);
  if (state.history.kind !== autoGrain()) params.set("hk", state.history.kind);
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
  if (params.get("m") && state.assets[params.get("m")]) {
    state.market = params.get("m");
    state.openCloseupOnLoad = true;
  }
  if (["month", "year"].includes(params.get("pg"))) state.pools.grain = params.get("pg");
  if (["linear", "log", "share"].includes(params.get("ps"))) state.pools.scale = params.get("ps");
  [["f", "flows"], ["s", "selloffs"], ["b", "backdrop"]].forEach(([key, group]) => {
    const tab = params.get(key);
    if (tab && TAB_RENDERERS[tab] && document.querySelector(`[data-tabs="${group}"] [data-tab="${tab}"]`)) state.tabs[group] = tab;
  });
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

  // Chart or table, per card; a tabbed card keeps the choice across its tabs.
  document.querySelectorAll(".table-toggle").forEach((btn) => {
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const showTable = card.dataset.view !== "table";
      card.dataset.view = showTable ? "table" : "chart";
      btn.setAttribute("aria-pressed", String(showTable));
      btn.textContent = showTable ? "Chart" : "Table";
      if (!showTable) renderAll();
    });
  });

  // Tabs: click, or arrow keys between them.
  document.querySelectorAll("[data-tabs]").forEach((card) => {
    const group = card.dataset.tabs;
    const tabs = [...card.querySelectorAll('[role="tab"]')];
    tabs.forEach((btn, i) => {
      btn.addEventListener("click", () => showTab(group, btn.dataset.tab));
      btn.addEventListener("keydown", (ev) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
        if (!step) return;
        const next = tabs[(i + step + tabs.length) % tabs.length];
        next.focus();
        showTab(group, next.dataset.tab);
      });
    });
  });

  const dlg = $("#closeup-dialog");
  $("#closeup-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => {
    state.closeupOpen = false;
    writeHash();
  });
  document.querySelectorAll("#pools-grain button").forEach((btn) => btn.addEventListener("click", () => {
    state.pools.grain = btn.dataset.grain;
    writeHash();
    safely("where the money sits", renderPools, theme());
  }));
  document.querySelectorAll("#pools-scale button").forEach((btn) => btn.addEventListener("click", () => {
    state.pools.scale = btn.dataset.scale;
    writeHash();
    safely("where the money sits", renderPools, theme());
  }));
  document.querySelectorAll('a[href="#guide"]').forEach((a) => a.addEventListener("click", () => { $("#guide").open = true; }));

  // The ⋯ menu sits outside the scrolling range bar so it is never clipped: place it under
  // its button, kept on screen, and close it on any click elsewhere.
  const settings = document.querySelector(".settings");
  const placeMenu = () => {
    const btn = settings.querySelector("summary").getBoundingClientRect();
    const menu = settings.querySelector(".settings-menu");
    const width = menu.offsetWidth;
    menu.style.top = `${btn.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(btn.right - width, window.innerWidth - width - 8))}px`;
  };
  settings.addEventListener("toggle", () => { if (settings.open) placeMenu(); });
  window.addEventListener("scroll", () => { if (settings.open) placeMenu(); }, { passive: true });
  document.addEventListener("click", (ev) => { if (settings.open && !settings.contains(ev.target)) settings.open = false; });

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

  $("#replay-select").addEventListener("change", (ev) => {
    const view = viewFromKey(ev.target.value);
    if (view) replay(view, false);
    else exitReplay();
  });
  $("#replay-exit").addEventListener("click", exitReplay);
  $("#closeup-select").addEventListener("change", (ev) => openCloseup(ev.target.value));
  $("#share").addEventListener("click", share);
  document.querySelectorAll("#history-kind button").forEach((b) => b.addEventListener("click", () => {
    state.history.kind = b.dataset.kind;
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

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (mode === "auto") renderAll();
  });

  let pending;
  window.addEventListener("resize", () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      Object.values(state.charts).forEach((c) => c.resize());
      // The quadrant and the map lay themselves out for the width, so redraw the open one.
      if (state.data && ["map", "quadrant"].includes(state.tabs.flows)) renderTab(state.tabs.flows);
    }, 120);
  });
}

// Latest observation per source, flagged when it is later than its usual publishing lag.
function renderFreshness(data) {
  const list = $("#freshness");
  const rows = (data.meta && data.meta.freshness) || [];
  list.closest("div").hidden = !rows.length;
  const lag = { daily: 5, weekly: 12, "weekly, as of Tuesday": 14, monthly: 70 };
  list.replaceChildren(...rows.map((r) => {
    const li = document.createElement("li");
    const late = (parseDay(data.meta.as_of) - parseDay(r.as_of)) / 864e5 > (lag[r.cadence] || 70);
    const b = document.createElement("strong");
    b.textContent = `${r.name}: `;
    li.append(b, document.createTextNode(`${fmtDate(r.as_of)} (${r.cadence})${late ? " · later than usual" : ""}`));
    if (late) li.classList.add("late");
    return li;
  }));
}

async function main() {
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
  renderFreshness(data);

  // A replayed period lives in the wheel, so a shared replay link opens that tab.
  if (state.replay) state.tabs.flows = "classes";
  Object.entries(state.tabs).forEach(([group, tab]) => showTab(group, tab, { render: false, hash: false }));
  renderAll();
  if (state.openCloseupOnLoad) openCloseup(state.market);
}

main();
