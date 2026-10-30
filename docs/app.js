"use strict";

const state = { data: null, window: "20", charts: {}, assets: {}, groupIndex: {} };
const CASH_NODE = "Cash & sidelines";
// One market per class for the performance chart.
const REPRESENTATIVES = ["SPY", "TLT", "BIL", "GLD", "BTC-USD", "UUP"];

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
  if (ticker === CASH_NODE) return CASH_NODE;
  return state.assets[ticker] ? state.assets[ticker].name : ticker;
}

function assetColor(ticker, t) {
  if (ticker === CASH_NODE) return t.cash;
  const a = state.assets[ticker];
  return a ? t.groups[state.groupIndex[a.group] % t.groups.length] : t.muted;
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
  flows: "Estimated from each day's price and trading volume, and measured against each market's own normal over the past year, so only unusual buying or selling counts. Flows are pressure, not price: a market can rise while money leaves it, if the remaining buyers pay up. Not reported fund flows.",
  cash: "Cash balances the wheel: if more was sold than bought across the tracked markets, the difference is shown flowing into cash, and if more was bought, it is shown coming out of cash.",
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
  const month = { ...windowView(), wheel: d.windows["20"].wheel, span: "over the past month" };
  items.push(["Money flow: ", `${wheelHeadline(month)}.`]);
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
    { info: "spy", label: "S&P 500, 1 month", value: fmtPct(k.spy_20d), delta: `${fmtPct(k.drawdown)} from 1-year high` },
    { info: "vix", label: "VIX", value: fmtNum(k.vix, 1), delta: "Implied S&P 500 volatility" },
    { info: "btc", label: "Bitcoin, 1 month", value: fmtPct(k.btc_20d), delta: "Crypto risk appetite" },
    { info: "stablecoins", label: "Stablecoin supply", value: fmtUsdBn(k.stablecoins_bn), delta: `${fmtUsdBn(k.stablecoins_30d_bn, true)} in 30 days` },
    { info: "retail_mmf", label: "Money funds", value: fmtUsdBn(k.retail_mmf_bn), delta: `${fmtUsdBn(k.retail_mmf_3m_bn, true)} in 3 months` },
    { info: "net_liquidity", label: "Fed net liquidity", value: fmtUsdBn(k.net_liquidity_bn), delta: `${fmtUsdBn(k.net_liquidity_4w_bn, true)} in 4 weeks` },
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

const WINDOW_WORDS = { 5: "week", 20: "month", 60: "three months" };

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

function wheelHeadline(view) {
  const wheel = view.wheel;
  const entries = Object.entries(wheel.net).sort((a, b) => a[1] - b[1]);
  const [source, out] = entries[0];
  if (!wheel.links.length || out >= 0) return `Little money changed hands between classes ${view.span}`;
  const dests = wheel.links.filter((l) => l.source === source).sort((a, b) => b.value - a.value).slice(0, 2);
  const where = dests.map((l) => `${l.target} (${fmtUsdBn(l.value)})`).join(" and ");
  return `${fmtUsdBn(-out)} left ${source} ${view.span}, mostly into ${where}`;
}

// ---------- wheel views: the current window, a past week or month, or a past selloff ----------

state.replay = null;

function windowView() {
  const w = state.data.windows[state.window];
  const words = WINDOW_WORDS[state.window] || `${state.window} days`;
  return {
    start: w.start, end: w.end, wheel: w.wheel, span: `over the past ${words}`, hub: `moved in the past ${words}`,
    marketNets: Object.fromEntries(Object.entries(w.assets).map(([t, a]) => [t, a.net_flow_bn])),
  };
}

function historyView(kind, i) {
  const h = state.data.history[kind];
  const groups = state.data.groups;
  const wheel = {
    net: Object.fromEntries(groups.map((g) => [g, h.net[g][i]])),
    links: h.links[i].map(([a, b, v]) => ({ source: groups[a], target: groups[b], value: v })),
    total_bn: h.total[i],
  };
  const weekly = kind === "weekly";
  const mw = state.data.markets_weekly;
  const j = weekly && mw ? mw.end.indexOf(h.end[i]) : -1;
  const marketNets = j >= 0 ? Object.fromEntries(Object.entries(mw.net).map(([t, v]) => [t, v[j]])) : null;
  const name = weekly ? `the week of ${fmtDate(h.start[i])}` : parseDay(h.end[i]).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    start: h.start[i], end: h.end[i], wheel,
    span: `in ${name}`,
    hub: weekly ? "moved that week" : "moved that month",
    label: weekly ? `Week of ${fmtDate(h.start[i])}` : name,
    key: `${kind}:${i}`,
    marketNets,
  };
}

function episodeView(i) {
  const e = state.data.selloffs.episodes[i];
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
  return state.replay || windowView();
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
  now.textContent = "Now (selected window)";
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
  const [kind, i] = key.split(":");
  return kind === "ep" ? episodeView(+i) : historyView(kind, +i);
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
  const color = (g) => t.groups[idx[g] % t.groups.length];
  const matrix = groups.map(() => groups.map(() => 0));
  wheel.links.forEach((l) => { matrix[idx[l.source]][idx[l.target]] += l.value; });
  const outOf = (i) => d3.sum(matrix[i]);
  const into = (i) => d3.sum(matrix, (row) => row[i]);

  $("#wheel-headline").textContent = wheelHeadline(view);
  $("#wheel-sub").textContent = `${fmtRange(view.start, view.end)}. Estimated from price and volume, not reported fund flows.`;
  $("#wheel-sub").appendChild(infoButton("estimated flows", "flows"));

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
      showTip(`${groups[d.source.index]} → ${groups[d.target.index]}`, [["Estimated flow", fmtUsdBn(d.source.value)]], ev.clientX, ev.clientY);
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
    // Which markets inside the class drove it (cash itself is the balancing account).
    if (view.marketNets && g !== "Cash") {
      const movers = state.data.assets.filter((a) => a.group === g && view.marketNets[a.ticker] != null)
        .map((a) => [a.ticker, view.marketNets[a.ticker]])
        .sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 4);
      if (movers.length > 1) movers.forEach(([tk, v], k) => rows.push([`${k ? "" : "Driven by: "}${shortName(tk)}`, fmtUsdBn(v, true)]));
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
  const w = state.data.windows[state.window];
  const sk = w.sankey;
  $("#sankey-sub").textContent =
    `${fmtRange(w.start, w.end)}. ${fmtUsdBn(sk.total_out_bn)} estimated selling, ${fmtUsdBn(sk.total_in_bn)} estimated buying.`;
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
          formatter: (p) => (narrow ? assetName(p.name) : `${assetName(p.name)}  {v|${fmtUsdBn(nodeTotals[p.name])}}`),
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
  c.on("click", (p) => { if (p.dataType === "node" && p.name !== CASH_NODE) openCloseup(p.name); });
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
  return {
    type: "value",
    boundaryGap: ["12%", "12%"],
    interval: step,
    ...axisStyle(t),
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => fmtPct(v, 0) },
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
  const w = state.data.windows[state.window];
  const rows = Object.entries(w.assets)
    .filter(([, v]) => v.intensity != null)
    .sort((a, b) => a[1].intensity - b[1].intensity);
  const vals = rows.map(([, v]) => v.intensity);
  const intensityLabel = barLabel(t, vals, 0);
  const c = chart("chart-intensity");
  c.setOption({
    grid: barGrid(),
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p) => {
        const v = w.assets[rows[p.dataIndex][0]];
        return `<div style="margin-bottom:4px">${esc(assetName(rows[p.dataIndex][0]))}</div>` +
          row("Net pressure", fmtPct(v.intensity)) +
          row("Est. net flow", fmtUsdBn(v.net_flow_bn, true)) +
          row("Return", fmtPct(v.ret)) +
          row("Volume vs normal", `${fmtNum(v.volume_ratio, 2)}×`);
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
  table(cardTable("intensity"), ["Market", "Net pressure", "Est. net flow", "Return", "Volume vs normal"],
    rows.slice().reverse().map(([k, v]) => [
      assetName(k), fmtPct(v.intensity), fmtUsdBn(v.net_flow_bn, true), fmtPct(v.ret), `${fmtNum(v.volume_ratio, 2)}×`,
    ]));
}

// ---------- liquidity history ----------

state.history = { kind: "weekly", mode: "flows" };

function renderHistory(t) {
  const { kind, mode } = state.history;
  const h = state.data.history[kind];
  const groups = state.data.groups;
  const color = (g) => t.groups[state.groupIndex[g] % t.groups.length];
  document.querySelectorAll("#history-kind button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.kind === kind)));
  document.querySelectorAll("#history-mode button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));

  const totals = Object.fromEntries(groups.map((g) => [g, d3.sum(h.net[g])]));
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const [topIn, topOut] = [ranked[0], ranked[ranked.length - 1]];
  const span = `${fmtDate(h.start[0])} – ${fmtDate(h.end[h.end.length - 1])}`;
  $("#history-headline").textContent =
    `Since ${fmtMonth(h.start[0])}, the most money flowed into ${topIn[0]} (${fmtUsdBn(topIn[1], true)}) and out of ${topOut[0]} (${fmtUsdBn(topOut[1], true)})`;
  $("#history-sub").textContent = mode === "flows"
    ? `Net flow per ${kind === "weekly" ? "week" : "month"}, ${span}. Bars above zero are money coming in, below zero money going out. Shaded bands are S&P 500 selloffs.`
    : `Running total of net flows, ${span}. A rising line means a class keeps attracting money. Shaded bands are S&P 500 selloffs.`;

  const running = (arr) => { let acc = 0; return arr.map((v) => (acc += v)); };
  const series = groups.map((g, gi) => {
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

  const c = chart("chart-history");
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
    dataZoom: [{ type: "inside", start: narrowScreen() && kind === "weekly" ? 66 : 0, end: 100 }],
    series,
  }, true);
  c.off("click");
  c.on("click", (p) => replay(historyView(kind, p.dataIndex)));
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
    replay(historyView(kind, best));
  });

  table(cardTable("history"), ["Period", ...groups, "Total moved"],
    h.end.map((d, i) => [fmtRange(h.start[i], d), ...groups.map((g) => fmtUsdBn(h.net[g][i], true)), fmtUsdBn(h.total[i])]).reverse());
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

  // Stats row.
  const m = d.windows["20"].assets[tk] || {};
  const st = (d.streaks.assets || {})[tk];
  const pb = d.selloffs.playbook.find((r) => r.ticker === tk);
  const stats = [
    ["Past month", fmtPct(m.ret), m.intensity != null ? `Net ${m.intensity >= 0 ? "buying" : "selling"} ${fmtPct(Math.abs(m.intensity), 0, false)} of normal turnover` : ""],
    st ? ["Last 8 weeks", fmtUsdBn(st.total_bn, true), `Inflows in ${st.inflow_weeks} of ${st.weeks} weeks`] : null,
    pb ? ["In past selloffs", `rose ${Math.round(pb.hit_rate * pb.episodes)} of ${pb.episodes}`, `Median move ${fmtPct(pb.median_ret)}`] : null,
    pb && pb.median_rebound != null ? ["After the bottom", fmtPct(pb.median_rebound), `Median over the next ${d.selloffs.rebound_days} trading days`] : null,
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

  if (!mw) return;
  const closes = mw.close[tk];
  const firstIdx = closes.findIndex((v) => v != null);
  const base = closes[firstIdx];
  const price = mw.end.map((e, i) => [e, closes[i] == null ? null : Math.round((closes[i] / base) * 1000) / 10]);
  const flows = mw.end.map((e, i) => [e, mw.net[tk][i]]);
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
        return `<div style="margin-bottom:4px">Week ending ${esc(fmtDate(mw.end[i]))}</div>` +
          row("Price (indexed)", price[i][1] == null ? "–" : price[i][1].toFixed(1), t.groups[state.groupIndex[state.assets[tk].group]]) +
          row("Net flow that week", fmtUsdBn(flows[i][1], true));
      },
    },
    xAxis: [
      { type: "time", gridIndex: 0, ...axisStyle(t), axisLabel: { show: false }, splitLine: { show: false } },
      { type: "time", gridIndex: 1, ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, name: "Price, indexed to 100", nameGap: 12, nameTextStyle: { color: t.muted, fontSize: 11, align: "left" }, ...axisStyle(t), axisLine: { show: false }, splitNumber: narrow ? 3 : 4 },
      { type: "value", gridIndex: 1, name: "Weekly net flow", nameGap: 12, nameTextStyle: { color: t.muted, fontSize: 11, align: "left" }, ...axisStyle(t), axisLine: { show: false }, splitNumber: 3, axisLabel: { color: t.muted, fontSize: 11, formatter: fmtAxisUsd } },
    ],
    series: [
      {
        type: "line", xAxisIndex: 0, yAxisIndex: 0, data: price, showSymbol: false, connectNulls: true,
        lineStyle: { width: 2, color: t.groups[state.groupIndex[state.assets[tk].group]] },
        itemStyle: { color: t.groups[state.groupIndex[state.assets[tk].group]] },
        markArea: selloffBands(t),
      },
      {
        type: "bar", xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 8,
        data: flows.map(([e, v]) => ({ value: [e, v], itemStyle: { color: v >= 0 ? t.pos : t.neg } })),
        markArea: selloffBands(t),
      },
    ],
  }, true);
  table(cardTable("closeup"), ["Week ending", "Price (indexed)", "Net flow"],
    mw.end.map((e, i) => [fmtDate(e), price[i][1] == null ? "–" : price[i][1].toFixed(1), fmtUsdBn(flows[i][1], true)]).reverse());
}

// ---------- selloffs ----------

function renderPlaybook(t) {
  const s = state.data.selloffs;
  const done = s.episodes.filter((e) => !e.ongoing).length;
  $("#selloff-sub").textContent =
    `${done} completed S&P 500 selloffs of ${Math.round(s.threshold * 100)}% or more since ${s.episodes.length ? s.episodes[0].peak.slice(0, 4) : "–"}. ` +
    "What rose while stocks fell is where sellers' money went.";
  $("#threshold-text").textContent = `${Math.round(s.threshold * 100)}%`;
  const rows = s.playbook.slice().reverse();
  const vals = rows.map((r) => r.median_ret);
  const playbookLabel = barLabel(t, vals, 1);
  const c = chart("chart-playbook");
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
    s.playbook.map((r) => [
      assetName(r.ticker), fmtPct(r.median_ret), `${Math.round(r.hit_rate * r.episodes)}/${r.episodes}`,
      fmtPct(r.median_rebound), `${fmtNum(r.median_volume_ratio, 2)}×`,
    ]));
}

function renderHeatmap(t) {
  const s = state.data.selloffs;
  const eps = s.episodes.slice().reverse();
  const tickers = s.playbook.map((r) => r.ticker);
  const el = document.getElementById("chart-heatmap");
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
          row("Est. net flow", fmtUsdBn(a.net_flow_bn, true)) +
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
    const i = state.data.selloffs.episodes.indexOf(eps[p.data[1]]);
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
  const c3 = outlookCard("Momentum: last 8 weeks", "Markets with the most unusual buying or selling over the past two months. Persistent flows often continue for a while.");
  outlookList(c3, building.map(([t, v]) => ({ name: assetName(t), value: fmtUsdBn(v.total_bn, true), why: streakWhy(v) })), "Money building");
  outlookList(c3, leaving.map(([t, v]) => ({ name: assetName(t), value: fmtUsdBn(v.total_bn, true), why: streakWhy(v) })), "Money leaving");
  grid.appendChild(c3);

  // 4. Price vs flow: quiet buying into weakness, selling into strength (past month).
  const m = d.windows["20"].assets;
  const quiet = Object.entries(m).filter(([, v]) => v.intensity != null && v.intensity >= 0.05 && v.ret < 0).sort((a, b) => b[1].intensity - a[1].intensity);
  const selling = Object.entries(m).filter(([, v]) => v.intensity != null && v.intensity <= -0.05 && v.ret > 0).sort((a, b) => a[1].intensity - b[1].intensity);
  const c4 = outlookCard("Price and flow disagree", "Over the past month. Buying while the price falls can mean patient money is accumulating; selling into a rally can mean holders are cashing out.");
  const divRows = (rows, label) => rows.slice(0, 3).map(([t, v]) => ({
    name: assetName(t), value: fmtPct(v.ret), why: `${label} ${fmtPct(Math.abs(v.intensity), 0, false)} of normal turnover`,
  }));
  if (quiet.length) outlookList(c4, divRows(quiet, "Price fell, yet net buying was"), "Quiet buying");
  if (selling.length) outlookList(c4, divRows(selling, "Price rose, yet net selling was"), "Selling into strength");
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

function renderCash(t) {
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
    const pts = cash[p.key];
    const last = pts[pts.length - 1];
    const yearAgo = pts.find((x) => x[0] >= shiftDate(last[0], -365)) || pts[0];
    const card = document.getElementById(`chart-cash-${p.key}`).parentElement;
    card.querySelector(".figure").textContent = fmtUsdBn(last[1]);
    card.querySelector(".delta").textContent = `${fmtUsdBn(last[1] - yearAgo[1], true)} over 12 months`;
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

function lineOptions(t, { series, yFormatter, yMin, yMax, valueFormatter }) {
  return {
    grid: { left: 48, right: 110, top: 36, bottom: 28 },
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
    endLabel: { show: true, formatter: "{a}", color: t.text2, fontSize: 11 },
    labelLayout: { moveOverlap: "shiftY" },
    emphasis: { focus: "series" },
    ...extra,
  };
}

function renderRegime(t) {
  const r = state.data.regime;
  const hist = r.history;
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

function renderPerformance(t) {
  const p = state.data.performance;
  const tickers = REPRESENTATIVES.filter((tk) => p.series[tk]);
  chart("chart-performance").setOption(lineOptions(t, {
    series: tickers.map((tk) => lineSeries(t, assetName(tk), p.dates.map((d, i) => [d, p.series[tk][i]]), assetColor(tk, t))),
    yFormatter: (v) => v.toFixed(0),
    valueFormatter: (v) => v.toFixed(1),
  }), true);
  const step = 5;
  table(cardTable("performance"), ["Date", ...tickers.map(assetName)],
    p.dates.map((d, i) => [fmtDate(d), ...tickers.map((tk) => (p.series[tk][i] == null ? "–" : p.series[tk][i].toFixed(1)))])
      .filter((_, i, arr) => (arr.length - 1 - i) % step === 0).reverse());
}

function renderCorrelation(t) {
  const c = state.data.correlations;
  const tickers = Object.keys(c.series);
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
  safely("headline", renderKpis);
  renderWindow();
  safely("liquidity history", renderHistory, t);
  safely("market close-up", renderCloseup, t);
  safely("selloff playbook", renderPlaybook, t);
  safely("selloff heatmap", renderHeatmap, t);
  safely("outlook", renderOutlook);
  safely("cash", renderCash, t);
  safely("risk appetite", renderRegime, t);
  safely("performance", renderPerformance, t);
  safely("correlation", renderCorrelation, t);
}

function renderWindow() {
  const t = theme();
  document.querySelectorAll("#window-picker button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.window === state.window));
  });
  safely("liquidity wheel", renderWheel, t);
  safely("rotation map", renderSankey, t);
  safely("buying vs selling", renderIntensity, t);
}

// Shareable links: the view lives in the URL hash (#w=20&r=ep:12&m=GLD&hk=monthly&hm=cumulative).
function writeHash() {
  if (!state.data) return;
  const params = new URLSearchParams();
  params.set("w", state.window);
  if (state.replay) params.set("r", state.replay.key);
  if (state.market !== "SPY") params.set("m", state.market);
  if (state.history.kind !== "weekly") params.set("hk", state.history.kind);
  if (state.history.mode !== "flows") params.set("hm", state.history.mode);
  history.replaceState(null, "", `#${params}`);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("w") && !params.has("r") && !params.has("m")) return;
  const d = state.data;
  if (d.windows[params.get("w")]) state.window = params.get("w");
  if (params.get("hk") && d.history[params.get("hk")]) state.history.kind = params.get("hk");
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
  document.querySelectorAll("#window-picker button").forEach((b) => {
    b.addEventListener("click", () => {
      state.window = b.dataset.window;
      state.replay = null;
      syncReplayControls();
      storage("set", "lfm-window", state.window);
      writeHash();
      renderWindow();
    });
  });

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
  const saved = storage("get", "lfm-window");
  if (saved && data.windows[saved]) state.window = saved;
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
