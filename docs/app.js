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
  const body = abs >= 1000 ? `$${(abs / 1000).toFixed(2)}T` : abs >= 10 ? `$${abs.toFixed(0)}B` : `$${abs.toFixed(1)}B`;
  if (x < 0) return MINUS + body;
  return (signed && x > 0 ? "+" : "") + body;
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

// ---------- KPI tiles ----------

function renderKpis() {
  const d = state.data;
  const k = d.kpis;
  const r = d.regime;
  const pos = Math.max(-2, Math.min(2, r.score ?? 0));
  const tiles = [
    {
      label: "Risk regime",
      value: r.label,
      delta: `Score ${fmtNum(r.score, 2, true)}`,
      gauge: ((pos + 2) / 4) * 100,
    },
    { label: "S&P 500, 1 month", value: fmtPct(k.spy_20d), delta: `${fmtPct(k.drawdown)} from 1-year high` },
    { label: "VIX", value: fmtNum(k.vix, 1), delta: "Implied S&P 500 volatility" },
    { label: "Bitcoin, 1 month", value: fmtPct(k.btc_20d), delta: "Crypto risk appetite" },
    { label: "Stablecoin supply", value: fmtUsdBn(k.stablecoins_bn), delta: `${fmtUsdBn(k.stablecoins_30d_bn, true)} in 30 days` },
    { label: "Retail money funds", value: fmtUsdBn(k.retail_mmf_bn), delta: `${fmtUsdBn(k.retail_mmf_3m_bn, true)} in 3 months` },
    { label: "Fed net liquidity", value: fmtUsdBn(k.net_liquidity_bn), delta: `${fmtUsdBn(k.net_liquidity_4w_bn, true)} in 4 weeks` },
  ];
  const root = $("#kpis");
  root.replaceChildren();
  tiles.forEach((tile) => {
    const el = document.createElement("div");
    el.className = "kpi";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = tile.label;
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

function wheelHeadline(wheel, windowKey) {
  const span = WINDOW_WORDS[windowKey] || `${windowKey} days`;
  const entries = Object.entries(wheel.net).sort((a, b) => a[1] - b[1]);
  const [source, out] = entries[0];
  if (!wheel.links.length || out >= 0) return `Little money changed hands between classes over the past ${span}`;
  const dests = wheel.links.filter((l) => l.source === source).sort((a, b) => b.value - a.value).slice(0, 2);
  const where = dests.map((l) => `${l.target} (${fmtUsdBn(l.value)})`).join(" and ");
  return `${fmtUsdBn(-out)} left ${source} over the past ${span}, mostly into ${where}`;
}

function renderWheel(t) {
  const w = state.data.windows[state.window];
  const wheel = w.wheel;
  const groups = state.data.groups;
  const idx = Object.fromEntries(groups.map((g, i) => [g, i]));
  const color = (g) => t.groups[idx[g] % t.groups.length];
  const matrix = groups.map(() => groups.map(() => 0));
  wheel.links.forEach((l) => { matrix[idx[l.source]][idx[l.target]] += l.value; });
  const outOf = (i) => d3.sum(matrix[i]);
  const into = (i) => d3.sum(matrix, (row) => row[i]);

  $("#wheel-headline").textContent = wheelHeadline(wheel, state.window);
  $("#wheel-sub").textContent = `${w.start} to ${w.end}. Estimated from price and volume, not reported fund flows.`;

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
  const ribbon = d3.ribbonArrow().radius(inner - 3).padAngle(1 / inner).headRadius(Math.min(16, inner * 0.08));

  const svg = d3.select(el).append("svg")
    .attr("viewBox", [-width / 2, -height / 2, width, height])
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", `${wheelHeadline(wheel, state.window)}. ${fmtUsdBn(wheel.total_bn)} moved between classes in total.`);

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
    arcs.attr("opacity", (g) => (g.index === i || matrix[i][g.index] || matrix[g.index][i] ? 1 : 0.35));
  }
  function highlightRibbon(d) {
    ribbons.attr("fill-opacity", (c) => (c === d ? 0.9 : 0.06));
    arcs.attr("opacity", (g) => (g.index === d.source.index || g.index === d.target.index ? 1 : 0.35));
  }
  function reset() {
    ribbons.attr("fill-opacity", 0.62);
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
    .text(`moved in the past ${WINDOW_WORDS[state.window] || state.window + " days"}`);
}

// ---------- rotation map ----------

function renderSankey(t) {
  const w = state.data.windows[state.window];
  const sk = w.sankey;
  $("#sankey-sub").textContent =
    `${w.start} to ${w.end}. ${fmtUsdBn(sk.total_out_bn)} estimated selling, ${fmtUsdBn(sk.total_in_bn)} estimated buying.`;
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
  table(cardTable("sankey"), ["From", "To", "Allocated flow"],
    sk.links.slice().sort((a, b) => b.value - a.value)
      .map((l) => [assetName(l.source), assetName(l.target), fmtUsdBn(l.value)]));
}

function renderIntensity(t) {
  const w = state.data.windows[state.window];
  const rows = Object.entries(w.assets)
    .filter(([, v]) => v.intensity != null)
    .sort((a, b) => a[1].intensity - b[1].intensity);
  const c = chart("chart-intensity");
  c.setOption({
    grid: { left: 120, right: 56, top: 8, bottom: 28 },
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
    xAxis: { type: "value", ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => fmtPct(v, 0) } },
    yAxis: {
      type: "category",
      data: rows.map(([k]) => assetName(k)),
      ...axisStyle(t),
      axisLabel: { color: t.text2, fontSize: 12 },
      splitLine: { show: false },
    },
    series: [{
      type: "bar",
      barWidth: "60%",
      data: rows.map(([, v]) => ({
        value: v.intensity,
        itemStyle: {
          color: v.intensity >= 0 ? t.pos : t.neg,
          borderRadius: v.intensity >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
        },
      })),
      label: {
        show: true,
        position: "right",
        color: t.text2,
        fontSize: 11,
        formatter: (p) => fmtPct(p.value, 0),
      },
      labelLayout: (p) => (rows[p.dataIndex][1].intensity < 0 ? { x: p.rect.x - 4, align: "right" } : {}),
    }],
  }, true);
  table(cardTable("intensity"), ["Market", "Net pressure", "Est. net flow", "Return", "Volume vs normal"],
    rows.slice().reverse().map(([k, v]) => [
      assetName(k), fmtPct(v.intensity), fmtUsdBn(v.net_flow_bn, true), fmtPct(v.ret), `${fmtNum(v.volume_ratio, 2)}×`,
    ]));
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
  const c = chart("chart-playbook");
  c.setOption({
    grid: { left: 120, right: 56, top: 8, bottom: 28 },
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
    xAxis: { type: "value", ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => fmtPct(v, 0) } },
    yAxis: {
      type: "category",
      data: rows.map((r) => assetName(r.ticker)),
      ...axisStyle(t),
      axisLabel: { color: t.text2, fontSize: 12 },
      splitLine: { show: false },
    },
    series: [{
      type: "bar",
      barWidth: "60%",
      data: rows.map((r) => ({
        value: r.median_ret,
        itemStyle: { color: r.median_ret >= 0 ? t.pos : t.neg, borderRadius: r.median_ret >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
      })),
      label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: (p) => fmtPct(p.value, 1) },
      labelLayout: (p) => (rows[p.dataIndex].median_ret < 0 ? { x: p.rect.x - 4, align: "right" } : {}),
    }],
  }, true);
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
  const label = (e) => `${e.peak.slice(0, 7)}  ${fmtPct(e.drawdown, 0)}${e.ongoing ? " · now" : ""}`;
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
        return `<div style="margin-bottom:4px">${esc(assetName(tk))} · ${esc(e.peak)} → ${esc(e.trough)}${e.ongoing ? " (ongoing)" : ""}</div>` +
          row("Return", fmtPct(a.ret)) +
          row("S&P 500", fmtPct(e.drawdown)) +
          row("Est. net flow", fmtUsdBn(a.net_flow_bn, true)) +
          row("Volume vs normal", `${fmtNum(a.volume_ratio, 2)}×`) +
          row(`Next ${s.rebound_days} days`, fmtPct(a.rebound));
      },
    },
    xAxis: {
      type: "category",
      data: tickers.map((tk) => tk.replace("-USD", "")),
      ...axisStyle(t),
      axisLine: { show: false },
      axisLabel: { color: t.text2, fontSize: 11, rotate: 45, interval: 0 },
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
  const cashKeys = [["stablecoins", "Stablecoins"], ["retail_mmf", "Retail MMF"], ["rrp", "Reverse repo"], ["net_liquidity", "Net liquidity"]];
  table(cardTable("heatmap"),
    ["Selloff", "S&P 500", ...tickers.filter((tk) => tk !== "SPY").map((tk) => tk.replace("-USD", "")), ...cashKeys.map((c) => `Δ ${c[1]}`)],
    eps.map((e) => [
      `${e.peak} → ${e.trough}${e.ongoing ? " (ongoing)" : ""}`,
      fmtPct(e.drawdown),
      ...tickers.filter((tk) => tk !== "SPY").map((tk) => fmtPct(e.assets[tk] && e.assets[tk].ret)),
      ...cashKeys.map(([k]) => fmtUsdBn(e.cash[k], true)),
    ]));
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
        formatter: (ps) => `<div style="margin-bottom:4px">${esc(ps[0].data[0])}</div>` + row(p.title, fmtUsdBn(ps[0].data[1]), t.groups[0]),
      },
      xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 10, hideOverlap: true } },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 3,
        ...axisStyle(t),
        axisLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 10, formatter: (v) => fmtUsdBn(v).replace(".00T", "T") },
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
        return `<div style="margin-bottom:4px">${esc(ps[0].data[0])}</div>` +
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
          label: { color: t.muted, fontSize: 11, position: "insideStartTop" },
          data: [{ yAxis: 0.5, label: { formatter: "Risk-on" } }, { yAxis: -0.5, label: { formatter: "Risk-off" } }],
        },
      })],
      yFormatter: (v) => fmtNum(v, 1, true),
      valueFormatter: (v) => fmtNum(v, 2, true),
    }),
    legend: { show: false },
    grid: { left: 40, right: 16, top: 12, bottom: 28 },
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
    hist.slice().reverse().filter((_, i) => i % 5 === 0).map(([d, v]) => [d, fmtNum(v, 2, true), v >= 0.5 ? "Risk-on" : v <= -0.5 ? "Risk-off" : "Neutral"]));
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
    p.dates.map((d, i) => [d, ...tickers.map((tk) => (p.series[tk][i] == null ? "–" : p.series[tk][i].toFixed(1)))])
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
    c.dates.map((d, i) => [d, ...tickers.map((tk) => fmtNum(c.series[tk][i], 2, true))]).reverse());
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
  safely("headline", renderKpis);
  renderWindow();
  safely("selloff playbook", renderPlaybook, t);
  safely("selloff heatmap", renderHeatmap, t);
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
      storage("set", "lfm-window", state.window);
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

  const saved = storage("get", "lfm-window");
  if (saved && data.windows[saved]) state.window = saved;

  $("#demo-banner").hidden = !data.meta.demo;
  $("#asof").textContent = `Data as of ${data.meta.as_of}`;
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
