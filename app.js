const state = {
  payload: null,
  month: null,
  selectedFunds: [],
  maxSelectableFunds: 5,
  pointsByFundMonth: {},
  factorTableFactor: null,
  factorTrendFund: null,
  stockFund: null,
  stock: null,
};

const monthSelect = document.getElementById("month-select");
const fundSelect = document.getElementById("fund-select");
const selectionHint = document.getElementById("selection-hint");
const benchmarkNote = document.getElementById("benchmark-note");

const subfactorMetricSelect = document.getElementById("subfactor-metric-select");
const subfactorTopnSelect = document.getElementById("subfactor-topn-select");
const subfactorTitle = document.getElementById("subfactor-title");

const factorTableGroupSelect = document.getElementById("factor-table-group-select");
const factorTableFactorSelect = document.getElementById("factor-table-factor-select");
const factorTableTitle = document.getElementById("factor-table-title");
const factorTableSummary = document.getElementById("factor-table-summary");
const factorTableBody = document.getElementById("factor-table-body");

const factorTrendModeSelect = document.getElementById("factor-trend-mode-select");
const factorTrendFundSelect = document.getElementById("factor-trend-fund-select");

const stockFundSelect = document.getElementById("stock-fund-select");
const stockSelect = document.getElementById("stock-select");
const stockTitle = document.getElementById("stock-title");

const palette = ["#0f766e", "#ea580c", "#2563eb", "#dc2626", "#7c3aed"];

const COLOR = {
  portfolio: "#0f766e",
  benchmark: "#ea580c",
  active: "#2563eb",
  residual: "#dc2626",
  industry: "#0ea5a4",
  style: "#f59e0b",
};

const PLOT_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
};

const BASE_LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(255,255,255,0.9)",
  margin: { l: 62, r: 22, t: 30, b: 66 },
  legend: { orientation: "h", y: 1.12 },
  font: { family: "Noto Sans TC, Segoe UI, sans-serif", size: 12 },
};

function mergeLayout(extra) {
  return {
    ...BASE_LAYOUT,
    ...extra,
    margin: { ...BASE_LAYOUT.margin, ...(extra?.margin || {}) },
  };
}

function toNum(value) {
  if (value === null || value === undefined) return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function fmtPct(value) {
  const x = toNum(value);
  if (x === null) return "N/A";
  return `${(x * 100).toFixed(2)}%`;
}

function fmtNum(value, digits = 3) {
  const x = toNum(value);
  if (x === null) return "N/A";
  return x.toFixed(digits);
}

function fmtPctSigned(value, digits = 4) {
  const x = toNum(value);
  if (x === null) return "N/A";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(digits)}%`;
}

function valueClass(value) {
  const x = toNum(value);
  if (x === null) return "";
  return x >= 0 ? "pos" : "neg";
}

function setHint(message) {
  selectionHint.textContent = message;
}

function plot(id, traces, layout) {
  Plotly.newPlot(id, traces, mergeLayout(layout), PLOT_CONFIG);
}

function plotEmpty(id, message = "無資料") {
  plot(id, [], {
    xaxis: { visible: false },
    yaxis: { visible: false },
    annotations: [
      {
        x: 0.5,
        y: 0.5,
        xref: "paper",
        yref: "paper",
        text: message,
        showarrow: false,
        font: { size: 13, color: "#64748b" },
      },
    ],
  });
}

function fundMeta(code) {
  return state.payload.meta.funds.find((f) => f.fund_code === code) || { fund_name: code };
}

function fundLabel(code) {
  const meta = fundMeta(code);
  return `${code} ${meta.fund_name}`;
}

function factorLabel(name) {
  return state.payload.meta.factorLabels?.[name] || name;
}

function getFund(code) {
  return state.payload.funds[code] || null;
}

function getFundSeries(code) {
  return getFund(code)?.series || [];
}

function getPoint(code, month) {
  return state.pointsByFundMonth[code]?.[month] || null;
}

function getFactorBlock(code, month) {
  return getFund(code)?.factorByMonth?.[month] || null;
}

function getStockMonthData(code, month) {
  return getFund(code)?.stocksByMonth?.[month] || null;
}

function getStockRecord(code, month, stockId) {
  return getStockMonthData(code, month)?.records?.[stockId] || null;
}

function initDataMaps() {
  const map = {};
  Object.entries(state.payload.funds).forEach(([code, fundObj]) => {
    map[code] = {};
    (fundObj.series || []).forEach((row) => {
      map[code][row.date] = row;
    });
  });
  state.pointsByFundMonth = map;
}

function syncSelectedFundsInDom() {
  const selected = new Set(state.selectedFunds);
  [...fundSelect.options].forEach((opt) => {
    opt.selected = selected.has(opt.value);
  });
}

function enforceFundSelectionLimit(nextValues) {
  if (nextValues.length <= state.maxSelectableFunds) return nextValues;

  const kept = [...state.selectedFunds];
  for (const value of nextValues) {
    if (!kept.includes(value) && kept.length < state.maxSelectableFunds) {
      kept.push(value);
    }
  }
  return kept.slice(0, state.maxSelectableFunds);
}

function updateStockFundOptions() {
  const fundCodes = state.selectedFunds.length
    ? state.selectedFunds
    : (state.payload.meta.funds || []).map((f) => f.fund_code);

  stockFundSelect.innerHTML = fundCodes
    .map((code) => `<option value="${code}">${fundLabel(code)}</option>`)
    .join("");

  if (!fundCodes.length) {
    state.stockFund = null;
    return;
  }

  if (!state.stockFund || !fundCodes.includes(state.stockFund)) {
    state.stockFund = fundCodes[0];
  }
  stockFundSelect.value = state.stockFund;
}

function updateStockOptions() {
  const monthData = state.stockFund ? getStockMonthData(state.stockFund, state.month) : null;
  const assets = monthData?.assets || [];

  if (!assets.length) {
    stockSelect.innerHTML = `<option value="">無持股資料</option>`;
    stockSelect.disabled = true;
    state.stock = null;
    return;
  }

  stockSelect.disabled = false;
  stockSelect.innerHTML = assets.map((a) => `<option value="${a}">${a}</option>`).join("");

  if (!state.stock || !assets.includes(state.stock)) {
    state.stock = assets[0];
  }
  stockSelect.value = state.stock;
}

function renderBenchmarkNote() {
  const text = state.payload.meta.benchmarkDefinition || "";
  benchmarkNote.textContent = text ? `Active Return / IR 的 Benchmark：${text}` : "";
}

function renderMetricCards() {
  const container = document.getElementById("metric-grid");
  if (!state.selectedFunds.length) {
    container.innerHTML = `<article class="metric-card"><div class="label">請先選擇基金</div></article>`;
    return;
  }

  const cards = state.selectedFunds
    .map((code) => {
      const p = getPoint(code, state.month);
      if (!p) return "";
      return `
        <article class="metric-card">
          <div class="label">${fundLabel(code)}</div>
          <div class="value ${valueClass(p.returnPort)}">${fmtPct(p.returnPort)}</div>
          <div class="metric-sub">Active Return: <strong>${fmtPct(p.returnActive)}</strong></div>
          <div class="metric-sub">Tracking Error: <strong>${fmtPct(p.trackingError)}</strong></div>
          <div class="metric-sub">Sharpe / IR: <strong>${fmtNum(p.sharpePort)} / ${fmtNum(p.information)}</strong></div>
        </article>
      `;
    })
    .join("");

  container.innerHTML = cards || `<article class="metric-card"><div class="label">該月份無資料</div></article>`;
}

function renderCumPortChart() {
  if (!state.selectedFunds.length) {
    plotEmpty("chart-cum-port");
    return;
  }

  const traces = state.selectedFunds.map((code, idx) => {
    const series = getFundSeries(code);
    return {
      x: series.map((d) => d.date),
      y: series.map((d) => d.cumPort),
      mode: "lines+markers",
      name: fundLabel(code),
      line: { width: 2.4, color: palette[idx % palette.length] },
    };
  });

  plot("chart-cum-port", traces, {
    yaxis: { tickformat: ".1%", title: "Cumulative Return" },
    xaxis: { title: "Month" },
  });
}

function renderCumActiveChart() {
  if (!state.selectedFunds.length) {
    plotEmpty("chart-cum-active");
    return;
  }

  const traces = state.selectedFunds.map((code, idx) => {
    const series = getFundSeries(code);
    return {
      x: series.map((d) => d.date),
      y: series.map((d) => d.cumActive),
      mode: "lines+markers",
      name: fundLabel(code),
      line: { width: 2.4, color: palette[idx % palette.length] },
    };
  });

  plot("chart-cum-active", traces, {
    yaxis: { tickformat: ".1%", title: "Cumulative Active Return" },
    xaxis: { title: "Month" },
  });
}

function renderGroupCompareChart(chartId, groupKey) {
  if (!state.selectedFunds.length) {
    plotEmpty(chartId);
    return;
  }

  const x = state.selectedFunds;
  plot(
    chartId,
    [
      {
        x,
        y: x.map((f) => getPoint(f, state.month)?.[groupKey]?.industry ?? null),
        type: "bar",
        name: "Industry",
        marker: { color: COLOR.industry },
      },
      {
        x,
        y: x.map((f) => getPoint(f, state.month)?.[groupKey]?.style ?? null),
        type: "bar",
        name: "Style",
        marker: { color: COLOR.style },
      },
      {
        x,
        y: x.map((f) => getPoint(f, state.month)?.[groupKey]?.residual ?? null),
        type: "bar",
        name: "Residual",
        marker: { color: COLOR.residual },
      },
    ],
    {
      barmode: "group",
      yaxis: {
        tickformat: ".2%",
        title: groupKey === "groupReturn" ? "Return Contribution" : "Variance Contribution",
      },
      xaxis: { title: "Fund" },
    }
  );
}

function sumFinite(values) {
  let hasValue = false;
  let total = 0;
  for (const v of values || []) {
    const x = toNum(v);
    if (x === null) continue;
    hasValue = true;
    total += x;
  }
  return hasValue ? total : null;
}

function syncFactorTrendFundOptions() {
  if (!factorTrendFundSelect) return;

  const codes = state.selectedFunds.length
    ? [...state.selectedFunds]
    : (state.payload.meta.funds || []).map((f) => f.fund_code);

  if (!codes.length) {
    factorTrendFundSelect.innerHTML = `<option value="">(no fund)</option>`;
    factorTrendFundSelect.disabled = true;
    state.factorTrendFund = null;
    return;
  }

  factorTrendFundSelect.disabled = false;
  const prev = state.factorTrendFund || factorTrendFundSelect.value;
  factorTrendFundSelect.innerHTML = codes
    .map((code) => `<option value="${code}">${fundLabel(code)}</option>`)
    .join("");

  state.factorTrendFund = codes.includes(prev) ? prev : codes[0];
  factorTrendFundSelect.value = state.factorTrendFund;
}

function groupContributionAtMonth(code, month, mode, kind) {
  const point = getPoint(code, month);
  const block = getFactorBlock(code, month);
  if (!point || !block) {
    return { industry: null, style: null, residual: null };
  }

  const portIndustry = sumFinite(block?.industry?.[kind === "risk" ? "pv" : "pr"]);
  const portStyle = sumFinite(block?.style?.[kind === "risk" ? "pv" : "pr"]);
  const benchIndustry = sumFinite(block?.industry?.[kind === "risk" ? "bv" : "br"]);
  const benchStyle = sumFinite(block?.style?.[kind === "risk" ? "bv" : "br"]);

  const totalPort = toNum(kind === "risk" ? point.variancePort : point.returnPort);
  const totalBench = toNum(kind === "risk" ? point.varianceBench : point.returnBench);

  const portResidual =
    totalPort === null || portIndustry === null || portStyle === null
      ? null
      : totalPort - portIndustry - portStyle;
  const benchResidual =
    totalBench === null || benchIndustry === null || benchStyle === null
      ? null
      : totalBench - benchIndustry - benchStyle;

  const pick = (p, b) => {
    if (mode === "portfolio") return p;
    if (mode === "benchmark") return b;
    if (p === null && b === null) return null;
    return (p || 0) - (b || 0);
  };

  return {
    industry: pick(portIndustry, benchIndustry),
    style: pick(portStyle, benchStyle),
    residual: pick(portResidual, benchResidual),
  };
}

function renderFactorTrendCharts() {
  if (!factorTrendModeSelect || !factorTrendFundSelect) return;

  syncFactorTrendFundOptions();

  if (!state.factorTrendFund) {
    plotEmpty("chart-factor-trend-return");
    plotEmpty("chart-factor-trend-risk");
    return;
  }

  const code = state.factorTrendFund;
  const series = getFundSeries(code);
  if (!series.length) {
    plotEmpty("chart-factor-trend-return");
    plotEmpty("chart-factor-trend-risk");
    return;
  }

  const mode = factorTrendModeSelect.value || "portfolio";
  const modeLabel = mode === "active" ? "Active" : mode === "benchmark" ? "Benchmark" : "Portfolio";
  const groups = [
    { key: "industry", name: "Industry", color: COLOR.industry },
    { key: "style", name: "Style", color: COLOR.style },
    { key: "residual", name: "Residual", color: COLOR.residual },
  ];

  const returnTraces = groups.map((group) => ({
    x: series.map((d) => d.date),
    y: series.map((d) => groupContributionAtMonth(code, d.date, mode, "return")[group.key]),
    mode: "lines+markers",
    name: group.name,
    line: { width: 2.2, color: group.color },
    marker: { size: 5 },
  }));

  const riskTraces = groups.map((group) => ({
    x: series.map((d) => d.date),
    y: series.map((d) => groupContributionAtMonth(code, d.date, mode, "risk")[group.key]),
    mode: "lines+markers",
    name: group.name,
    line: { width: 2.2, color: group.color },
    marker: { size: 5 },
  }));

  const titleSuffix = `${modeLabel} - ${fundLabel(code)}`;

  plot("chart-factor-trend-return", returnTraces, {
    yaxis: { tickformat: ".2%", title: "Return Contribution" },
    xaxis: { title: "Month" },
    title: titleSuffix,
  });

  plot("chart-factor-trend-risk", riskTraces, {
    yaxis: { tickformat: ".2%", title: "Variance Contribution" },
    xaxis: { title: "Month" },
    title: titleSuffix,
  });
}

function renderCompareTab() {
  renderMetricCards();
  renderCumPortChart();
  renderCumActiveChart();
  renderGroupCompareChart("chart-group-return", "groupReturn");
  renderGroupCompareChart("chart-group-variance", "groupVariance");
  renderFactorTrendCharts();
}

function getSubfactorMetricValue(block, group, idx, metric) {
  const p = toNum(block?.[group]?.pr?.[idx]);
  const b = toNum(block?.[group]?.br?.[idx]);

  if (metric === "portfolio") return p;
  if (metric === "benchmark") return b;
  if (p === null && b === null) return null;
  return (p || 0) - (b || 0);
}

function buildSubfactorRows(groupName, factorList, metric) {
  return factorList
    .map((factor, idx) => {
      const valuesByFund = {};
      for (const code of state.selectedFunds) {
        const block = getFactorBlock(code, state.month);
        valuesByFund[code] = getSubfactorMetricValue(block, groupName, idx, metric);
      }

      const score = Math.max(
        ...state.selectedFunds.map((code) => Math.abs(toNum(valuesByFund[code]) || 0))
      );

      return {
        factor,
        label: factorLabel(factor),
        valuesByFund,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function renderSubfactorCompareChart(chartId, groupName, factorList) {
  if (!state.selectedFunds.length) {
    plotEmpty(chartId);
    return;
  }

  const metric = subfactorMetricSelect.value;
  const topN = Number(subfactorTopnSelect.value || 15);
  const rows = buildSubfactorRows(groupName, factorList, metric).slice(0, topN);

  if (!rows.length) {
    plotEmpty(chartId);
    return;
  }

  const yLabels = rows.map((r) => r.label);
  const traces = state.selectedFunds.map((code, idx) => ({
    y: yLabels,
    x: rows.map((r) => r.valuesByFund[code]),
    type: "bar",
    orientation: "h",
    name: fundLabel(code),
    marker: { color: palette[idx % palette.length] },
  }));

  plot(chartId, traces, {
    barmode: "group",
    margin: { l: 230, r: 16, t: 30, b: 70 },
    xaxis: { title: "Return Contribution", tickformat: ".2%" },
    yaxis: { title: "Sub-Factor", autorange: "reversed", automargin: true },
  });
}

function renderSubfactorTab() {
  const selectedCount = state.selectedFunds.length;
  subfactorTitle.textContent = `子因子報酬比較 - ${state.month}（${selectedCount} 檔基金）`;

  renderSubfactorCompareChart(
    "chart-subfactor-industry",
    "industry",
    state.payload.meta.industryFactors || []
  );
  renderSubfactorCompareChart(
    "chart-subfactor-style",
    "style",
    state.payload.meta.styleFactors || []
  );
}

function factorDirectionTag(value) {
  const x = toNum(value);
  if (x === null) {
    return { text: "N/A", cls: "dir-flat" };
  }
  if (x > 1.0e-12) {
    return { text: "正向 ▲", cls: "dir-up" };
  }
  if (x < -1.0e-12) {
    return { text: "負向 ▼", cls: "dir-down" };
  }
  return { text: "中性 －", cls: "dir-flat" };
}

function factorTableFactorsByGroup(group) {
  const industrySet = new Set(state.payload.meta.industryFactors || []);
  const styleSet = new Set(state.payload.meta.styleFactors || []);
  if (group === "industry") return [...industrySet];
  if (group === "style") return [...styleSet];
  return [...industrySet, ...styleSet];
}

function syncFactorTableFactorOptions(rows) {
  if (!factorTableFactorSelect) return rows[0]?.factor || null;

  if (!rows.length) {
    factorTableFactorSelect.innerHTML = `<option value="">(no factor)</option>`;
    factorTableFactorSelect.disabled = true;
    state.factorTableFactor = null;
    return null;
  }

  factorTableFactorSelect.disabled = false;
  const prev = state.factorTableFactor || factorTableFactorSelect.value;
  factorTableFactorSelect.innerHTML = rows
    .map((r) => `<option value="${r.factor}">${r.label}</option>`)
    .join("");

  state.factorTableFactor = rows.some((r) => r.factor === prev) ? prev : rows[0].factor;
  factorTableFactorSelect.value = state.factorTableFactor;
  return state.factorTableFactor;
}

function renderFactorTableTrendChart(factor) {
  if (!factor) {
    plotEmpty("chart-factor-table-trend", "請先選擇因子");
    return;
  }

  const dates = state.payload.meta.dates || [];
  const y = dates.map((d) => toNum(state.payload.factorReturnsByMonth?.[d]?.[factor]));
  const colors = y.map((v) => {
    if (v === null) return "#cbd5e1";
    if (v > 0) return "#dc2626";
    if (v < 0) return "#16a34a";
    return "#94a3b8";
  });

  plot(
    "chart-factor-table-trend",
    [
      {
        x: dates,
        y,
        type: "bar",
        marker: { color: colors },
        hovertemplate: "%{x}<br>%{y:.4%}<extra></extra>",
      },
    ],
    {
      yaxis: { tickformat: ".2%", title: "Factor Return" },
      xaxis: { title: "Month" },
      title: factorLabel(factor),
      shapes: [
        {
          type: "line",
          xref: "paper",
          x0: 0,
          x1: 1,
          y0: 0,
          y1: 0,
          line: { color: "#334155", width: 1, dash: "dot" },
        },
      ],
      showlegend: false,
    }
  );
}

function renderFactorTableTab() {
  factorTableTitle.textContent = `因子報酬表 - ${state.month}`;

  const monthMap = state.payload.factorReturnsByMonth?.[state.month];
  if (!monthMap) {
    factorTableSummary.textContent = "該月份無因子報酬資料。";
    factorTableBody.innerHTML = `<tr><td colspan="4">無資料</td></tr>`;
    syncFactorTableFactorOptions([]);
    plotEmpty("chart-factor-table-trend");
    return;
  }

  const group = factorTableGroupSelect.value || "all";
  const factors = factorTableFactorsByGroup(group);
  const styleSet = new Set(state.payload.meta.styleFactors || []);

  const rows = factors
    .map((factor) => {
      const value = toNum(monthMap[factor]);
      const direction = factorDirectionTag(value);
      const type = styleSet.has(factor) ? "風格" : "產業";
      return {
        factor,
        label: factorLabel(factor),
        type,
        value,
        direction,
      };
    })
    .sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0));

  const selectedFactor = syncFactorTableFactorOptions(rows);

  if (!rows.length) {
    factorTableSummary.textContent = "該條件下無可用因子。";
    factorTableBody.innerHTML = `<tr><td colspan="4">無資料</td></tr>`;
    plotEmpty("chart-factor-table-trend");
    return;
  }

  const upCount = rows.filter((r) => (r.value || 0) > 1.0e-12).length;
  const downCount = rows.filter((r) => (r.value || 0) < -1.0e-12).length;
  const flatCount = rows.length - upCount - downCount;
  factorTableSummary.textContent = `共 ${rows.length} 個因子，正向 ${upCount}、負向 ${downCount}、中性 ${flatCount}。`;

  factorTableBody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.type}</td>
        <td>${r.label}</td>
        <td>${fmtPctSigned(r.value)}</td>
        <td><span class="${r.direction.cls}">${r.direction.text}</span></td>
      </tr>
    `
    )
    .join("");

  renderFactorTableTrendChart(selectedFactor);
}

function renderCards(containerId, cards) {
  const container = document.getElementById(containerId);
  container.innerHTML = cards
    .map((card) => {
      const details = (card.details || [])
        .map((d) => `<div class="metric-sub">${d.label}: <strong>${d.value}</strong></div>`)
        .join("");
      return `
        <article class="metric-card">
          <div class="label">${card.label}</div>
          <div class="value ${valueClass(card.rawValue)}">${card.value}</div>
          ${details}
        </article>
      `;
    })
    .join("");
}

function renderVerticalSingle(chartId, label, value, title, color, tickformat = ".2%") {
  plot(
    chartId,
    [
      {
        x: [label],
        y: [value],
        type: "bar",
        marker: { color },
      },
    ],
    {
      yaxis: { tickformat, title },
      xaxis: { title: "Factor" },
    }
  );
}

function renderHorizontalSingle(chartId, rows, key, xTitle, color, tickformat = ".2%") {
  if (!rows.length) {
    plotEmpty(chartId);
    return;
  }

  plot(
    chartId,
    [
      {
        y: rows.map((r) => r.label),
        x: rows.map((r) => r[key]),
        type: "bar",
        orientation: "h",
        marker: { color },
      },
    ],
    {
      margin: { l: 150, r: 18, t: 26, b: 65 },
      xaxis: { title: xTitle, tickformat },
      yaxis: { automargin: true, autorange: "reversed" },
    }
  );
}

function renderStockTab() {
  const stockChartIds = [
    "chart-stock-group-return",
    "chart-stock-group-variance",
    "chart-stock-industry-return",
    "chart-stock-industry-variance",
    "chart-stock-industry-weight",
    "chart-stock-style-return",
    "chart-stock-style-variance",
    "chart-stock-style-weight",
  ];

  if (!state.stockFund) {
    stockTitle.textContent = "個股歸因";
    renderCards("stock-metrics", [{ label: "請先選擇基金", value: "-", rawValue: null }]);
    stockChartIds.forEach((id) => plotEmpty(id));
    return;
  }

  stockTitle.textContent = `個股歸因 - ${fundLabel(state.stockFund)} (${state.month})`;

  const monthData = getStockMonthData(state.stockFund, state.month);
  if (!monthData?.assets?.length || !state.stock) {
    renderCards("stock-metrics", [{ label: "該月無持股資料", value: "-", rawValue: null }]);
    stockChartIds.forEach((id) => plotEmpty(id));
    return;
  }

  const record = getStockRecord(state.stockFund, state.month, state.stock);
  if (!record) {
    renderCards("stock-metrics", [{ label: "無該個股資料", value: "-", rawValue: null }]);
    stockChartIds.forEach((id) => plotEmpty(id));
    return;
  }

  renderCards("stock-metrics", [
    {
      label: `${state.stock} 報酬率`,
      value: fmtPct(record.ret),
      rawValue: record.ret,
      details: [{ label: "個股變異數", value: fmtPct(record.var) }],
    },
    {
      label: "Portfolio 權重",
      value: fmtPct(record.wPort),
      rawValue: record.activeWeight,
      details: [
        { label: "Benchmark 權重", value: fmtPct(record.wBench) },
        { label: "Active 權重", value: fmtPct(record.activeWeight) },
      ],
    },
    {
      label: "群組報酬（Industry）",
      value: fmtPct(record.groupRet?.[0]),
      rawValue: record.groupRet?.[0],
      details: [
        { label: "Style", value: fmtPct(record.groupRet?.[1]) },
        { label: "Residual", value: fmtPct(record.groupRet?.[2]) },
      ],
    },
    {
      label: "群組風險（Industry）",
      value: fmtPct(record.groupVar?.[0]),
      rawValue: record.groupVar?.[0],
      details: [
        { label: "Style", value: fmtPct(record.groupVar?.[1]) },
        { label: "Residual", value: fmtPct(record.groupVar?.[2]) },
      ],
    },
  ]);

  plot(
    "chart-stock-group-return",
    [
      {
        x: ["Industry", "Style", "Residual"],
        y: [record.groupRet?.[0], record.groupRet?.[1], record.groupRet?.[2]],
        type: "bar",
        marker: { color: [COLOR.industry, COLOR.style, COLOR.residual] },
      },
    ],
    { yaxis: { tickformat: ".2%", title: "Return Contribution" } }
  );

  plot(
    "chart-stock-group-variance",
    [
      {
        x: ["Industry", "Style", "Residual"],
        y: [record.groupVar?.[0], record.groupVar?.[1], record.groupVar?.[2]],
        type: "bar",
        marker: { color: [COLOR.industry, COLOR.style, COLOR.residual] },
      },
    ],
    { yaxis: { tickformat: ".2%", title: "Variance Contribution" } }
  );

  const industryLabel = factorLabel(record.industry?.factor || "Industry");
  renderVerticalSingle(
    "chart-stock-industry-return",
    industryLabel,
    record.industry?.r,
    "Return Contribution",
    COLOR.portfolio,
    ".2%"
  );
  renderVerticalSingle(
    "chart-stock-industry-variance",
    industryLabel,
    record.industry?.v,
    "Variance Contribution",
    COLOR.benchmark,
    ".2%"
  );
  renderVerticalSingle(
    "chart-stock-industry-weight",
    industryLabel,
    record.industry?.x,
    "Weighted Exposure",
    "#334155",
    ",.4f"
  );

  const styleFactors = state.payload.meta.styleFactors || [];
  const styleRows = styleFactors.map((factor, idx) => {
    const row = record.style?.[idx] || [null, null, null, null];
    return {
      label: factorLabel(factor),
      r: toNum(row[0]),
      v: toNum(row[1]),
      x: toNum(row[3]),
    };
  });

  const byRet = [...styleRows].sort((a, b) => Math.abs(b.r || 0) - Math.abs(a.r || 0));
  const byVar = [...styleRows].sort((a, b) => Math.abs(b.v || 0) - Math.abs(a.v || 0));
  const byX = [...styleRows].sort((a, b) => Math.abs(b.x || 0) - Math.abs(a.x || 0));

  renderHorizontalSingle("chart-stock-style-return", byRet, "r", "Return Contribution", COLOR.portfolio, ".2%");
  renderHorizontalSingle("chart-stock-style-variance", byVar, "v", "Variance Contribution", COLOR.benchmark, ".2%");
  renderHorizontalSingle("chart-stock-style-weight", byX, "x", "Weighted Exposure", "#334155", ",.4f");
}

function resizePlotsInActiveTab() {
  const panel = document.querySelector(".tab-panel.is-active");
  if (!panel) return;
  panel.querySelectorAll(".chart").forEach((el) => {
    if (el?.data) Plotly.Plots.resize(el);
  });
}

function scheduleResizeActiveTab() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resizePlotsInActiveTab());
  });
}

function bindWindowResize() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scheduleResizeActiveTab(), 120);
  });
}

function renderAll() {
  renderCompareTab();
  renderSubfactorTab();
  renderFactorTableTab();
  renderStockTab();
  scheduleResizeActiveTab();
}

function bindTabs() {
  const buttons = document.querySelectorAll(".tab-button");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-tab");
      buttons.forEach((b) => b.classList.remove("is-active"));
      panels.forEach((p) => p.classList.remove("is-active"));
      button.classList.add("is-active");
      document.getElementById(target).classList.add("is-active");
      scheduleResizeActiveTab();
    });
  });
}

function initSelectors() {
  const dates = state.payload.meta.dates || [];
  monthSelect.innerHTML = dates.map((d) => `<option value="${d}">${d}</option>`).join("");
  state.month = dates[dates.length - 1] || null;
  monthSelect.value = state.month;

  const funds = state.payload.meta.funds || [];
  fundSelect.innerHTML = funds
    .map((f) => `<option value="${f.fund_code}">${f.fund_code} ${f.fund_name}</option>`)
    .join("");

  state.maxSelectableFunds = Number(state.payload.meta.maxSelectableFunds || 5);
  state.selectedFunds = funds.slice(0, Math.min(3, state.maxSelectableFunds)).map((f) => f.fund_code);

  syncSelectedFundsInDom();
  setHint(`已選 ${state.selectedFunds.length} / ${state.maxSelectableFunds}`);
  syncFactorTrendFundOptions();
  updateStockFundOptions();
  updateStockOptions();
  renderBenchmarkNote();
}

function bindControls() {
  monthSelect.addEventListener("change", (e) => {
    state.month = e.target.value;
    updateStockOptions();
    renderAll();
  });

  fundSelect.addEventListener("change", () => {
    const picked = [...fundSelect.selectedOptions].map((o) => o.value);
    const limited = enforceFundSelectionLimit(picked);
    state.selectedFunds = limited;
    syncSelectedFundsInDom();

    if (picked.length > limited.length) {
      setHint(`最多可選 ${state.maxSelectableFunds} 檔基金，已保留前 ${state.maxSelectableFunds} 檔。`);
    } else {
      setHint(`已選 ${state.selectedFunds.length} / ${state.maxSelectableFunds}`);
    }

    updateStockFundOptions();
    updateStockOptions();
    renderAll();
  });

  subfactorMetricSelect.addEventListener("change", () => {
    renderSubfactorTab();
    scheduleResizeActiveTab();
  });

  subfactorTopnSelect.addEventListener("change", () => {
    renderSubfactorTab();
    scheduleResizeActiveTab();
  });

  factorTableGroupSelect.addEventListener("change", () => {
    renderFactorTableTab();
    scheduleResizeActiveTab();
  });

  factorTableFactorSelect?.addEventListener("change", (e) => {
    state.factorTableFactor = e.target.value || null;
    renderFactorTableTrendChart(state.factorTableFactor);
    scheduleResizeActiveTab();
  });

  factorTrendModeSelect?.addEventListener("change", () => {
    renderCompareTab();
    scheduleResizeActiveTab();
  });

  factorTrendFundSelect?.addEventListener("change", (e) => {
    state.factorTrendFund = e.target.value || null;
    renderCompareTab();
    scheduleResizeActiveTab();
  });

  stockFundSelect.addEventListener("change", (e) => {
    state.stockFund = e.target.value || null;
    updateStockOptions();
    renderStockTab();
    scheduleResizeActiveTab();
  });

  stockSelect.addEventListener("change", (e) => {
    state.stock = e.target.value || null;
    renderStockTab();
    scheduleResizeActiveTab();
  });
}

async function loadPayload() {
  const res = await fetch("./data/payload.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load payload.json (${res.status})`);
  return res.json();
}

async function init() {
  try {
    state.payload = await loadPayload();
    initDataMaps();
    bindTabs();
    initSelectors();
    bindControls();
    bindWindowResize();
    renderAll();
  } catch (err) {
    const shell = document.querySelector(".shell");
    shell.innerHTML = `
      <div class="card">
        <h2>載入失敗</h2>
        <p>${err.message}</p>
        <p>請先執行 <code>python .\\scripts\\build_payload.py</code> 重新產生 payload。</p>
      </div>
    `;
    console.error(err);
  }
}

init();
