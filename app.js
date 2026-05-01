const state = {
  payload: null,
  month: null,
  stock: null,
};

const monthSelect = document.getElementById("month-select");
const stockSelect = document.getElementById("stock-select");

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
  legend: { orientation: "h", y: 1.11 },
  font: { family: "Noto Sans TC, Segoe UI, sans-serif", size: 12 },
};

function mergeLayout(extra) {
  return {
    ...BASE_LAYOUT,
    ...extra,
    margin: { ...BASE_LAYOUT.margin, ...(extra?.margin || {}) },
  };
}

function isNearZero(value, eps = 1e-10) {
  return Math.abs(Number(value || 0)) <= eps;
}

function allNearZero(values, eps = 1e-10) {
  return (values || []).every((v) => isNearZero(v, eps));
}

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function fmtNum(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function valueClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value >= 0 ? "pos" : "neg";
}

function factorLabel(factor) {
  return state.payload?.meta?.factorLabels?.[factor] || factor;
}

function prettyFactorList(factors) {
  return (factors || []).map((f) => factorLabel(f));
}

function renderMetricCards(containerId, cards) {
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

function plot(id, traces, layout) {
  Plotly.newPlot(id, traces, mergeLayout(layout), PLOT_CONFIG);
}

function getPortfolioDataByMonth(month) {
  return {
    metrics: state.payload.portfolio.metricsByMonth[month],
    group: state.payload.portfolio.groupByMonth[month],
    industryRows: state.payload.portfolio.industryFactorsByMonth[month] || [],
    styleRows: state.payload.portfolio.styleFactorsByMonth[month] || [],
  };
}

function updateStockOptions() {
  const monthData = state.payload.stocks.byMonth[state.month];
  const assets = monthData?.assets || [];
  stockSelect.innerHTML = assets.map((a) => `<option value="${a}">${a}</option>`).join("");

  if (!assets.length) {
    state.stock = null;
    return;
  }

  if (!assets.includes(state.stock)) state.stock = assets[0];
  stockSelect.value = state.stock;
}

function zeroMarkerTraceVertical(categories, values) {
  const x = [];
  const y = [];
  categories.forEach((c, i) => {
    if (isNearZero(values[i])) {
      x.push(c);
      y.push(0);
    }
  });
  if (!x.length) return null;
  return {
    type: "scatter",
    mode: "markers",
    x,
    y,
    showlegend: false,
    marker: { color: COLOR.benchmark, size: 8, symbol: "diamond-open" },
    hovertemplate: "Benchmark ≈ 0<extra></extra>",
  };
}

function zeroMarkerTraceHorizontal(categories, values) {
  const x = [];
  const y = [];
  categories.forEach((c, i) => {
    if (isNearZero(values[i])) {
      x.push(0);
      y.push(c);
    }
  });
  if (!x.length) return null;
  return {
    type: "scatter",
    mode: "markers",
    x,
    y,
    showlegend: false,
    marker: { color: COLOR.benchmark, size: 7, symbol: "diamond-open" },
    hovertemplate: "Benchmark ≈ 0<extra></extra>",
  };
}

function nearZeroAnnotation(enabled) {
  if (!enabled) return [];
  return [
    {
      xref: "paper",
      yref: "paper",
      x: 1,
      y: 1.15,
      text: "Benchmark 在此圖接近 0",
      showarrow: false,
      font: { size: 11, color: COLOR.benchmark },
    },
  ];
}

function renderPortfolioMetrics(metrics, group) {
  const activeVariance = metrics.trackingError != null ? metrics.trackingError ** 2 : null;
  renderMetricCards("portfolio-metrics", [
    {
      label: "Return",
      value: fmtPct(metrics.returnPort),
      rawValue: metrics.returnPort,
      details: [
        { label: "Benchmark", value: fmtPct(metrics.returnBench) },
        { label: "Active", value: fmtPct(metrics.returnActive) },
      ],
    },
    {
      label: "Variance",
      value: fmtPct(metrics.variancePort),
      rawValue: metrics.variancePort,
      details: [
        { label: "Benchmark", value: fmtPct(metrics.varianceBench) },
        { label: "Active (TE^2)", value: fmtPct(activeVariance) },
      ],
    },
    {
      label: "Sharpe / IR",
      value: fmtNum(metrics.sharpePort),
      rawValue: metrics.sharpePort,
      details: [
        { label: "Benchmark Sharpe", value: fmtNum(metrics.sharpeBench) },
        { label: "Active IR", value: fmtNum(metrics.information) },
      ],
    },
    {
      label: "Tracking Error",
      value: fmtPct(metrics.trackingError),
      rawValue: metrics.trackingError,
      details: [
        { label: "Benchmark", value: "-" },
        { label: "Active", value: fmtPct(metrics.trackingError) },
      ],
    },
  ]);
}

function renderPortfolioSeries() {
  const series = state.payload.portfolio.series;
  const dates = series.map((s) => s.date);

  plot(
    "chart-cum-returns",
    [
      {
        x: dates,
        y: series.map((s) => s.cumPort),
        mode: "lines+markers",
        name: "Portfolio",
        line: { color: COLOR.portfolio, width: 2.5 },
      },
      {
        x: dates,
        y: series.map((s) => s.cumBench),
        mode: "lines+markers",
        name: "Benchmark",
        line: { color: COLOR.benchmark, width: 2.5 },
      },
    ],
    {
      yaxis: { tickformat: ".1%", title: "Cumulative Return" },
      xaxis: { title: "Month" },
    }
  );

  plot(
    "chart-active-return",
    [
      {
        x: dates,
        y: series.map((s) => s.returnActive),
        type: "bar",
        name: "Monthly Active Return",
        marker: { color: COLOR.active, opacity: 0.72 },
      },
      {
        x: dates,
        y: series.map((s) => s.cumActive),
        mode: "lines+markers",
        name: "Cumulative Active Return",
        yaxis: "y2",
        line: { color: COLOR.residual, width: 2.2 },
      },
    ],
    {
      yaxis: { tickformat: ".1%", title: "Monthly Active Return" },
      yaxis2: {
        overlaying: "y",
        side: "right",
        tickformat: ".1%",
        title: "Cumulative Active Return",
      },
      xaxis: { title: "Month" },
    }
  );
}

function renderGroupCharts(group) {
  const labels = ["產業", "風格", "殘差"];
  const keys = ["industry", "style", "residual"];
  const portReturn = keys.map((k) => group.return[k].portfolio);
  const benchReturn = keys.map((k) => group.return[k].benchmark);
  const portVar = keys.map((k) => group.variance[k].portfolio);
  const benchVar = keys.map((k) => group.variance[k].benchmark);

  function groupedBars(id, yPort, yBench, title) {
    const traces = [
      {
        x: labels,
        y: yPort,
        type: "bar",
        name: "Portfolio",
        marker: { color: COLOR.portfolio },
      },
      {
        x: labels,
        y: yBench,
        type: "bar",
        name: "Benchmark",
        marker: { color: COLOR.benchmark },
      },
    ];
    const zeroMarkers = zeroMarkerTraceVertical(labels, yBench);
    if (zeroMarkers) traces.push(zeroMarkers);

    plot(id, traces, {
      barmode: "group",
      yaxis: { title, tickformat: ".2%" },
      annotations: nearZeroAnnotation(allNearZero(yBench)),
    });
  }

  groupedBars("chart-group-return", portReturn, benchReturn, "Return");
  groupedBars("chart-group-variance", portVar, benchVar, "Variance");
}

function renderFactorCompareCharts(rows, prefix, withBenchmark = true) {
  const labels = prettyFactorList(rows.map((r) => r.factor));
  const portReturn = rows.map((r) => r.portfolio.return);
  const benchReturn = rows.map((r) => r.benchmark.return);
  const portVar = rows.map((r) => r.portfolio.variance);
  const benchVar = rows.map((r) => r.benchmark.variance);
  const portWeight = rows.map((r) => r.portfolio.weight);
  const benchWeight = rows.map((r) => r.benchmark.weight);

  function hGroup(id, left, right, title, percent = true) {
    const traces = [
      {
        y: labels,
        x: left,
        type: "bar",
        orientation: "h",
        name: "Portfolio",
        marker: { color: COLOR.portfolio },
      },
    ];

    if (withBenchmark) {
      traces.push({
        y: labels,
        x: right,
        type: "bar",
        orientation: "h",
        name: "Benchmark",
        marker: { color: COLOR.benchmark },
      });
      const zeroMarkers = zeroMarkerTraceHorizontal(labels, right);
      if (zeroMarkers) traces.push(zeroMarkers);
    }

    plot(id, traces, {
      barmode: "group",
      xaxis: { title, tickformat: percent ? ".2%" : ",.3f" },
      yaxis: { automargin: true, categoryorder: "total ascending" },
      annotations: withBenchmark ? nearZeroAnnotation(allNearZero(right)) : [],
    });
  }

  hGroup(`chart-${prefix}-return`, portReturn, benchReturn, "Return Contribution");
  hGroup(`chart-${prefix}-variance`, portVar, benchVar, "Variance Contribution");
  hGroup(`chart-${prefix}-weight`, portWeight, benchWeight, "Weight / Exposure", false);
}

function renderPortfolioTab() {
  const { metrics, group, industryRows, styleRows } = getPortfolioDataByMonth(state.month);
  renderPortfolioMetrics(metrics, group);
  renderPortfolioSeries();
  renderGroupCharts(group);
  renderFactorCompareCharts(industryRows, "industry", true);
  renderFactorCompareCharts(styleRows, "style", false);
}

function renderStockMetrics(record) {
  const activeWeight =
    record.weightPort != null && record.weightBench != null
      ? record.weightPort - record.weightBench
      : null;

  renderMetricCards("stock-metrics", [
    {
      label: "\u500b\u80a1\u5831\u916c\u7387",
      value: fmtPct(record.return),
      rawValue: record.return,
      details: [{ label: "\u500b\u80a1\u8b8a\u7570\u6578", value: fmtPct(record.variance) }],
    },
    {
      label: "Portfolio \u6b0a\u91cd",
      value: fmtPct(record.weightPort),
      rawValue: activeWeight,
      details: [
        { label: "Benchmark \u6b0a\u91cd", value: fmtPct(record.weightBench) },
        { label: "Active \u6b0a\u91cd", value: fmtPct(activeWeight) },
      ],
    },
    {
      label: "\u7fa4\u7d44\u5831\u916c\u62c6\u89e3",
      value: fmtPct(record.groupReturn.industry),
      rawValue: record.groupReturn.industry,
      details: [
        { label: "\u98a8\u683c", value: fmtPct(record.groupReturn.style) },
        { label: "\u6b98\u5dee", value: fmtPct(record.groupReturn.residual) },
      ],
    },
    {
      label: "\u7fa4\u7d44\u8b8a\u7570\u6578\u62c6\u89e3",
      value: fmtPct(record.groupVariance.industry),
      rawValue: record.groupVariance.industry,
      details: [
        { label: "\u98a8\u683c", value: fmtPct(record.groupVariance.style) },
        { label: "\u6b98\u5dee", value: fmtPct(record.groupVariance.residual) },
      ],
    },
  ]);
}

function renderStockGroupCharts(record) {
  const labels = ["產業", "風格", "殘差"];
  const ret = [record.groupReturn.industry, record.groupReturn.style, record.groupReturn.residual];
  const vari = [
    record.groupVariance.industry,
    record.groupVariance.style,
    record.groupVariance.residual,
  ];

  plot(
    "chart-stock-group-return",
    [
      {
        x: labels,
        y: ret,
        type: "bar",
        marker: { color: [COLOR.industry, COLOR.style, COLOR.residual] },
      },
    ],
    { yaxis: { tickformat: ".2%", title: "Return" } }
  );

  plot(
    "chart-stock-group-variance",
    [
      {
        x: labels,
        y: vari,
        type: "bar",
        marker: { color: [COLOR.industry, COLOR.style, COLOR.residual] },
      },
    ],
    { yaxis: { tickformat: ".2%", title: "Variance" } }
  );
}

function renderStockFactorBreakdown(record, factors, prefix) {
  const labels = prettyFactorList(factors.map((f) => f.factor));
  const exposures = factors.map((f) => f.exposure);
  const retContrib = factors.map((f) => f.returnContribution);
  const varContrib = factors.map((f) => f.varianceContribution);

  plot(
    `chart-stock-${prefix}-exposure`,
    [
      {
        y: labels,
        x: exposures,
        type: "bar",
        orientation: "h",
        marker: { color: prefix === "industry" ? COLOR.industry : COLOR.style },
      },
    ],
    { xaxis: { title: "Exposure", tickformat: ",.3f" }, yaxis: { automargin: true } }
  );

  plot(
    `chart-stock-${prefix}-return`,
    [
      {
        y: labels,
        x: retContrib,
        type: "bar",
        orientation: "h",
        marker: { color: prefix === "industry" ? COLOR.portfolio : COLOR.benchmark },
      },
    ],
    { xaxis: { title: "Return Contribution", tickformat: ".2%" }, yaxis: { automargin: true } }
  );

  plot(
    `chart-stock-${prefix}-variance`,
    [
      {
        y: labels,
        x: varContrib,
        type: "bar",
        orientation: "h",
        marker: { color: "#334155" },
      },
    ],
    { xaxis: { title: "Variance Contribution", tickformat: ".2%" }, yaxis: { automargin: true } }
  );
}

function renderStockAllExposure(record) {
  const industry = record.industryFactors || [];
  const style = record.styleFactors || [];

  plot(
    "chart-stock-all-exposure",
    [
      {
        y: prettyFactorList(industry.map((x) => x.factor)),
        x: industry.map((x) => x.exposure),
        type: "bar",
        orientation: "h",
        name: "Industry",
        marker: { color: COLOR.industry },
      },
      {
        y: prettyFactorList(style.map((x) => x.factor)),
        x: style.map((x) => x.exposure),
        type: "bar",
        orientation: "h",
        name: "Style",
        marker: { color: COLOR.style },
      },
    ],
    {
      barmode: "group",
      xaxis: { title: "Exposure", tickformat: ",.3f" },
      yaxis: { automargin: true },
    }
  );
}

function renderStockTab() {
  const monthData = state.payload.stocks.byMonth[state.month];
  if (!monthData?.assets?.length) return;

  if (!state.stock || !monthData.records[state.stock]) {
    state.stock = monthData.assets[0];
    stockSelect.value = state.stock;
  }

  const record = monthData.records[state.stock];
  renderStockMetrics(record);
  renderStockGroupCharts(record);
  renderStockFactorBreakdown(record, record.industryFactors, "industry");
  renderStockFactorBreakdown(record, record.styleFactors, "style");
  renderStockAllExposure(record);
}

function renderFactorTab() {
  const factors = state.payload.factorStats.factors;
  const returnsByMonth = state.payload.factorStats.returnsByMonth;

  const sorted = factors
    .map((factor) => ({ factor, value: returnsByMonth[state.month]?.[factor] ?? null }))
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  plot(
    "chart-factor-cross",
    [
      {
        y: prettyFactorList(sorted.map((r) => r.factor)),
        x: sorted.map((r) => r.value),
        type: "bar",
        orientation: "h",
        marker: { color: sorted.map((r) => ((r.value || 0) >= 0 ? COLOR.portfolio : COLOR.residual)) },
      },
    ],
    {
      margin: { l: 130, r: 20, t: 26, b: 65 },
      xaxis: { title: `Factor Return (${state.month})`, tickformat: ".2%" },
      yaxis: { automargin: true, categoryorder: "total ascending" },
    }
  );
}

function renderAll() {
  renderPortfolioTab();
  renderStockTab();
  renderFactorTab();
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
    });
  });
}

async function loadPayload() {
  const res = await fetch("./data/payload.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load payload.json (${res.status})`);
  return res.json();
}

function initSelectors() {
  const dates = state.payload.meta.dates;
  monthSelect.innerHTML = dates.map((d) => `<option value="${d}">${d}</option>`).join("");
  state.month = dates[dates.length - 1];
  monthSelect.value = state.month;
  updateStockOptions();
}

function bindControls() {
  monthSelect.addEventListener("change", (e) => {
    state.month = e.target.value;
    updateStockOptions();
    renderAll();
  });

  stockSelect.addEventListener("change", (e) => {
    state.stock = e.target.value;
    renderStockTab();
  });
}

async function init() {
  try {
    state.payload = await loadPayload();
    bindTabs();
    initSelectors();
    bindControls();
    renderAll();
  } catch (error) {
    const shell = document.querySelector(".shell");
    shell.innerHTML = `
      <div class="card">
        <h2>載入失敗</h2>
        <p>${error.message}</p>
        <p>請確認 <code>frontend/data/payload.json</code> 存在，並用靜態伺服器開啟。</p>
      </div>
    `;
    console.error(error);
  }
}

init();
