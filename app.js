const state = {
  payload: null,
  month: null,
  stock: null,
};

const monthSelect = document.getElementById("month-select");
const stockSelect = document.getElementById("stock-select");

const COLOR = {
  port: "#0f766e",
  bench: "#ea580c",
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

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/A";
  return `${(v * 100).toFixed(2)}%`;
}

function fmtNum(v, digits = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/A";
  return Number(v).toFixed(digits);
}

function valueClass(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return v >= 0 ? "pos" : "neg";
}

function factorLabel(factor) {
  return state.payload?.meta?.factorLabels?.[factor] || factor;
}

function prettyFactorList(factors) {
  return factors.map((f) => factorLabel(f));
}

function renderMetricCards(containerId, cards) {
  const container = document.getElementById(containerId);
  container.innerHTML = cards
    .map(
      (card) => `
      <article class="metric-card">
        <div class="label">${card.label}</div>
        <div class="value ${valueClass(card.rawValue)}">${card.value}</div>
      </article>
    `
    )
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
  stockSelect.innerHTML = assets
    .map((asset) => `<option value="${asset}">${asset}</option>`)
    .join("");
  if (!assets.length) {
    state.stock = null;
    return;
  }
  if (!assets.includes(state.stock)) state.stock = assets[0];
  stockSelect.value = state.stock;
}

function renderPortfolioMetrics(metrics, group) {
  renderMetricCards("portfolio-metrics", [
    { label: "Portfolio Return", value: fmtPct(metrics.returnPort), rawValue: metrics.returnPort },
    { label: "Benchmark Return", value: fmtPct(metrics.returnBench), rawValue: metrics.returnBench },
    { label: "Active Return", value: fmtPct(metrics.returnActive), rawValue: metrics.returnActive },
    {
      label: "Portfolio Variance",
      value: fmtPct(metrics.variancePort),
      rawValue: metrics.variancePort,
    },
    {
      label: "Benchmark Variance",
      value: fmtPct(metrics.varianceBench),
      rawValue: metrics.varianceBench,
    },
    { label: "Portfolio Sharpe", value: fmtNum(metrics.sharpePort), rawValue: metrics.sharpePort },
    { label: "Benchmark Sharpe", value: fmtNum(metrics.sharpeBench), rawValue: metrics.sharpeBench },
    { label: "Information", value: fmtNum(metrics.information), rawValue: metrics.information },
    {
      label: "Tracking Error",
      value: fmtPct(metrics.trackingError),
      rawValue: metrics.trackingError,
    },
    {
      label: "Σw_port",
      value: fmtPct(group.investedWeight.portfolio),
      rawValue: group.investedWeight.portfolio,
    },
    {
      label: "Σw_bench",
      value: fmtPct(group.investedWeight.benchmark),
      rawValue: group.investedWeight.benchmark,
    },
  ]);
}

function renderPortfolioSeries() {
  const series = state.payload.portfolio.series;
  const dates = series.map((s) => s.date);
  const cumPort = series.map((s) => s.cumPort);
  const cumBench = series.map((s) => s.cumBench);
  const activeMonthly = series.map((s) => s.returnActive);
  const activeCum = series.map((s) => s.cumActive);

  plot(
    "chart-cum-returns",
    [
      {
        x: dates,
        y: cumPort,
        mode: "lines+markers",
        name: "Portfolio",
        line: { color: COLOR.port, width: 2.5 },
      },
      {
        x: dates,
        y: cumBench,
        mode: "lines+markers",
        name: "Benchmark",
        line: { color: COLOR.bench, width: 2.5 },
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
        y: activeMonthly,
        type: "bar",
        name: "Monthly Active Return",
        marker: { color: COLOR.active, opacity: 0.7 },
      },
      {
        x: dates,
        y: activeCum,
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
  const groupKeys = ["industry", "style", "residual"];
  const portReturn = groupKeys.map((k) => group.return[k].portfolio);
  const benchReturn = groupKeys.map((k) => group.return[k].benchmark);
  const portVar = groupKeys.map((k) => group.variance[k].portfolio);
  const benchVar = groupKeys.map((k) => group.variance[k].benchmark);
  const portWeight = groupKeys.map((k) => group.weight[k].portfolio);
  const benchWeight = groupKeys.map((k) => group.weight[k].benchmark);

  const groupedBars = (id, yPort, yBench, yTitle) =>
    plot(
      id,
      [
        { x: labels, y: yPort, type: "bar", name: "Portfolio", marker: { color: COLOR.port } },
        {
          x: labels,
          y: yBench,
          type: "bar",
          name: "Benchmark",
          marker: { color: COLOR.bench },
        },
      ],
      { barmode: "group", yaxis: { title: yTitle, tickformat: ".2%" } }
    );

  groupedBars("chart-group-return", portReturn, benchReturn, "Return");
  groupedBars("chart-group-variance", portVar, benchVar, "Variance");
  groupedBars("chart-group-weight", portWeight, benchWeight, "Weight Metric");
}

function renderFactorCompareCharts(rows, prefix) {
  const labels = prettyFactorList(rows.map((r) => r.factor));
  const portReturn = rows.map((r) => r.portfolio.return);
  const benchReturn = rows.map((r) => r.benchmark.return);
  const portVar = rows.map((r) => r.portfolio.variance);
  const benchVar = rows.map((r) => r.benchmark.variance);
  const portWeight = rows.map((r) => r.portfolio.weight);
  const benchWeight = rows.map((r) => r.benchmark.weight);

  const makeHorizontal = (id, portY, benchY, title, isPercent = true) => {
    plot(
      id,
      [
        {
          y: labels,
          x: portY,
          type: "bar",
          orientation: "h",
          name: "Portfolio",
          marker: { color: COLOR.port },
        },
        {
          y: labels,
          x: benchY,
          type: "bar",
          orientation: "h",
          name: "Benchmark",
          marker: { color: COLOR.bench },
        },
      ],
      {
        barmode: "group",
        xaxis: { title, tickformat: isPercent ? ".2%" : ",.3f" },
        yaxis: { automargin: true, categoryorder: "total ascending" },
      }
    );
  };

  makeHorizontal(`chart-${prefix}-return`, portReturn, benchReturn, "Return Contribution");
  makeHorizontal(
    `chart-${prefix}-variance`,
    portVar,
    benchVar,
    "Variance Contribution"
  );
  makeHorizontal(`chart-${prefix}-weight`, portWeight, benchWeight, "Weight / Exposure", false);
}

function renderPortfolioTab() {
  const { metrics, group, industryRows, styleRows } = getPortfolioDataByMonth(state.month);
  renderPortfolioMetrics(metrics, group);
  renderPortfolioSeries();
  renderGroupCharts(group);
  renderFactorCompareCharts(industryRows, "industry");
  renderFactorCompareCharts(styleRows, "style");
}

function renderStockMetrics(record) {
  renderMetricCards("stock-metrics", [
    { label: "個股報酬率", value: fmtPct(record.return), rawValue: record.return },
    { label: "個股變異數", value: fmtPct(record.variance), rawValue: record.variance },
    { label: "w_port", value: fmtPct(record.weightPort), rawValue: record.weightPort },
    { label: "w_bench", value: fmtPct(record.weightBench), rawValue: record.weightBench },
    {
      label: "產業報酬拆解",
      value: fmtPct(record.groupReturn.industry),
      rawValue: record.groupReturn.industry,
    },
    {
      label: "風格報酬拆解",
      value: fmtPct(record.groupReturn.style),
      rawValue: record.groupReturn.style,
    },
    {
      label: "殘差報酬拆解",
      value: fmtPct(record.groupReturn.residual),
      rawValue: record.groupReturn.residual,
    },
    {
      label: "產業變異數拆解",
      value: fmtPct(record.groupVariance.industry),
      rawValue: record.groupVariance.industry,
    },
    {
      label: "風格變異數拆解",
      value: fmtPct(record.groupVariance.style),
      rawValue: record.groupVariance.style,
    },
    {
      label: "殘差變異數拆解",
      value: fmtPct(record.groupVariance.residual),
      rawValue: record.groupVariance.residual,
    },
  ]);
}

function renderStockGroupCharts(record) {
  const labels = ["產業", "風格", "殘差"];
  const ret = [
    record.groupReturn.industry,
    record.groupReturn.style,
    record.groupReturn.residual,
  ];
  const vari = [
    record.groupVariance.industry,
    record.groupVariance.style,
    record.groupVariance.residual,
  ];

  plot(
    "chart-stock-group-return",
    [{ x: labels, y: ret, type: "bar", marker: { color: [COLOR.industry, COLOR.style, COLOR.residual] } }],
    { yaxis: { tickformat: ".2%", title: "Return" } }
  );

  plot(
    "chart-stock-group-variance",
    [{ x: labels, y: vari, type: "bar", marker: { color: [COLOR.industry, COLOR.style, COLOR.residual] } }],
    { yaxis: { tickformat: ".2%", title: "Variance" } }
  );
}

function renderStockFactorBreakdown(record, factors, prefix) {
  const labels = prettyFactorList(factors.map((f) => f.factor));
  const exposures = factors.map((f) => f.exposure);
  const returnContrib = factors.map((f) => f.returnContribution);
  const varianceContrib = factors.map((f) => f.varianceContribution);

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
        x: returnContrib,
        type: "bar",
        orientation: "h",
        marker: { color: prefix === "industry" ? COLOR.port : COLOR.bench },
      },
    ],
    { xaxis: { title: "Return Contribution", tickformat: ".2%" }, yaxis: { automargin: true } }
  );

  plot(
    `chart-stock-${prefix}-variance`,
    [
      {
        y: labels,
        x: varianceContrib,
        type: "bar",
        orientation: "h",
        marker: { color: "#334155" },
      },
    ],
    {
      xaxis: { title: "Variance Contribution", tickformat: ".2%" },
      yaxis: { automargin: true },
    }
  );
}

function renderStockAllExposure(record) {
  const ind = record.industryFactors.map((x) => ({
    factor: x.factor,
    exposure: x.exposure,
  }));
  const sty = record.styleFactors.map((x) => ({
    factor: x.factor,
    exposure: x.exposure,
  }));

  plot(
    "chart-stock-all-exposure",
    [
      {
        y: prettyFactorList(ind.map((x) => x.factor)),
        x: ind.map((x) => x.exposure),
        type: "bar",
        orientation: "h",
        name: "Industry",
        marker: { color: COLOR.industry },
      },
      {
        y: prettyFactorList(sty.map((x) => x.factor)),
        x: sty.map((x) => x.exposure),
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
  const dates = state.payload.meta.dates;
  const returnsByMonth = state.payload.factorStats.returnsByMonth;

  const z = factors.map((factor) =>
    dates.map((d) => returnsByMonth[d]?.[factor] ?? null)
  );
  const yLabels = prettyFactorList(factors);

  plot(
    "chart-factor-heatmap",
    [
      {
        x: dates,
        y: yLabels,
        z,
        type: "heatmap",
        colorscale: "RdBu",
        reversescale: true,
        zmid: 0,
        colorbar: { title: "Return" },
      },
    ],
    {
      margin: { l: 110, r: 18, t: 26, b: 72 },
      xaxis: { title: "Month" },
      yaxis: { automargin: true },
    }
  );

  const rows = factors
    .map((factor) => ({
      factor,
      value: returnsByMonth[state.month]?.[factor] ?? null,
    }))
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  plot(
    "chart-factor-cross",
    [
      {
        y: prettyFactorList(rows.map((r) => r.factor)),
        x: rows.map((r) => r.value),
        type: "bar",
        orientation: "h",
        marker: {
          color: rows.map((r) => (r.value >= 0 ? COLOR.port : COLOR.residual)),
        },
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
      const targetId = button.getAttribute("data-tab");
      buttons.forEach((b) => b.classList.remove("is-active"));
      panels.forEach((p) => p.classList.remove("is-active"));
      button.classList.add("is-active");
      document.getElementById(targetId).classList.add("is-active");
    });
  });
}

async function loadPayload() {
  const response = await fetch("./data/payload.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load payload.json (${response.status})`);
  return response.json();
}

function initSelectors() {
  const dates = state.payload.meta.dates;
  monthSelect.innerHTML = dates.map((d) => `<option value="${d}">${d}</option>`).join("");
  state.month = dates[dates.length - 1];
  monthSelect.value = state.month;
  updateStockOptions();
}

function bindControls() {
  monthSelect.addEventListener("change", (event) => {
    state.month = event.target.value;
    updateStockOptions();
    renderAll();
  });
  stockSelect.addEventListener("change", (event) => {
    state.stock = event.target.value;
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
        <p>請確認 <code>frontend/data/payload.json</code> 是否存在，並使用靜態伺服器開啟頁面。</p>
      </div>
    `;
    console.error(error);
  }
}

init();
