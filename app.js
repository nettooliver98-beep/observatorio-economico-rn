const DATA_URL = "mapa_pib_rn_final.geojson";
const DATASETS = {
  pib: "data/camada_pib_municipio_ano.json",
  structure: "data/camada_estrutura_economica_municipio_ano.json",
  rais: "data/camada_rais_municipio_ano.json",
  raisSector: "data/camada_rais_setor_municipio_ano.json",
  caged: "data/camada_caged_municipio_mes.json",
  overview: "data/camada_visao_geral_municipio.json",
  demography: "data/sidra_populacao_rn_7436.json",
  populationMunicipal: "data/ibge_populacao_municipal_6579_2021_2025.json",
  bcbMacro: "data/bcb_sgs_macro_ultimos.json",
  siconfiEntes: "data/siconfi_entes_rn.json",
  indicatorControl: "data/indicadores_controle.json",
};

let geoLayer = null;
let selectedLayer = null;
let defaultView = null;
const selectedCityNames = new Set();
let selectedYear = 2021;
let selectedTrendYear = 2021;
const selectedYears = new Set([2021]);
let appData = {};
let allCityNames = [];
let cityRegionMap = new Map();
const cityLayers = new Map();
const mapEntries = [];

const REGION_BY_IMMEDIATE = {
  "Canguaretama": "Agreste Litoral Sul",
  "Santo Antônio - Passa e Fica - Nova Cruz": "Agreste Litoral Sul",
  "São Paulo do Potengi": "Potengi",
  "Santa Cruz": "Trairí",
};

const REGION_BY_MICRO = {
  "Vale do Açu": "Açu-Mossoró",
  "Mossoró": "Açu-Mossoró",
  "Agreste Potiguar": "Agreste Litoral Sul",
  "Litoral Sul": "Agreste Litoral Sul",
  "Pau dos Ferros": "Alto Oeste",
  "Serra de São Miguel": "Alto Oeste",
  "Umarizal": "Alto Oeste",
  "Baixa Verde": "Mato Grande",
  "Litoral Nordeste": "Mato Grande",
  "Seridó Ocidental": "Seridó",
  "Seridó Oriental": "Seridó",
  "Serra de Santana": "Seridó",
  "Angicos": "Sertão Central, Cabugi e Litoral Norte",
  "Macau": "Sertão Central, Cabugi e Litoral Norte",
  "Chapada do Apodi": "Sertão do Apodi",
  "Médio Oeste": "Sertão do Apodi",
  "Natal": "Terra dos Potiguares",
  "Macaíba": "Terra dos Potiguares",
  "Borborema Potiguar": "Trairí",
};

const FALLBACK_REGIONS = [
  "Açu-Mossoró",
  "Agreste Litoral Sul",
  "Alto Oeste",
  "Mato Grande",
  "Potengi",
  "Seridó",
  "Sertão Central, Cabugi e Litoral Norte",
  "Sertão do Apodi",
  "Terra dos Potiguares",
  "Trairí",
];

function createBaseMap(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return null;

  const baseMap = L.map(elementId, {
    attributionControl: false,
    dragging: true,
    doubleClickZoom: true,
    scrollWheelZoom: true,
    touchZoom: true,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(baseMap);

  return baseMap;
}

const map = createBaseMap("map");
const extraMaps = [
  "map-economic-activity",
  "map-income",
  "map-structure",
  "map-jobs",
  "map-movement",
  "map-public-accounts",
  "map-education",
  "map-employment-size",
  "map-employment-profile",
  "map-employment-education",
]
  .map((id) => ({ id, map: createBaseMap(id) }))
  .filter((entry) => entry.map);

mapEntries.push({ id: "map", map, layer: null, selectedLayer: null });
extraMaps.forEach((entry) => {
  mapEntries.push({ id: entry.id, map: entry.map, layer: null, selectedLayer: null });
});

const formatterBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const formatterNumber = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

function pickValue(properties, candidates) {
  for (const key of candidates) {
    const value = properties?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;

  const normalized = value
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  return Number(normalized) || 0;
}

function getCityName(properties) {
  return (
    pickValue(properties, [
      "name_muni",
      "nome_municipio",
      "nome_muni",
      "NM_MUN",
      "municipio",
      "Município",
      "Municipio",
    ]) || "Municipio sem nome"
  );
}

function getPib(properties) {
  return toNumber(pickValue(properties, ["pib_total", "PIB_TOTAL", "Pib_Total"]));
}

function formatMilReais(value) {
  return formatterBRL.format(value * 1000);
}

function formatCompactPib(value) {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(0)} Bi`;
  if (value >= 1000) return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} Mi`;
  return `R$ ${formatterNumber.format(value)} mil`;
}

function formatMoney(value) {
  return formatterBRL.format(Number(value) || 0);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function currentCityLabel() {
  if (!selectedCityNames.size) return "RN - todos os municipios";
  const names = [...selectedCityNames];
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

function yearFilter(row) {
  return !selectedYears.size || selectedYears.has(Number(row.ano));
}

function cityFilter(row) {
  return !selectedCityNames.size || selectedCityNames.has(row.nome_municipio);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function regionForCity(cityName) {
  const overview = (appData.overview || []).find((row) => row.nome_municipio === cityName);
  if (!overview) return "Sem regiao";
  return (
    REGION_BY_IMMEDIATE[overview.nome_regiao_imediata] ||
    REGION_BY_MICRO[overview.nome_microrregiao] ||
    overview.nome_regiao_imediata ||
    "Sem regiao"
  );
}

function colorForPib(value, min, max) {
  if (!value || max <= min) return "#e25345";

  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const stops = [
    [226, 83, 69],
    [227, 163, 33],
    [154, 224, 39],
    [23, 255, 34],
  ];

  const scaled = t * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - idx;
  const start = stops[idx];
  const end = stops[idx + 1];
  const rgb = start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * local),
  );

  return `rgb(${rgb.join(",")})`;
}

function tooltipContent(properties) {
  return `
    <strong>${getCityName(properties)}</strong>
    <span>PIBpc: ${formatCompactPib(getPib(properties))}</span>
  `;
}

function updateSelectedCity(properties, persist = false) {
  const text = `${getCityName(properties)} - PIBpc ${formatCompactPib(getPib(properties))}`;
  document.getElementById("selected-summary").textContent = persist
    ? `Selecionado: ${text}`
    : text;
}

function updateSelectionSummary() {
  const selected = [...selectedCityNames];
  const toggle = document.getElementById("municipio-picker-toggle");
  if (toggle) {
    toggle.textContent = !selected.length
      ? "Nenhuma cidade selecionada"
      : selected.length === allCityNames.length
        ? "Todas as cidades"
        : selected.length === 1
          ? selected[0]
          : `${selected.length} cidades selecionadas`;
  }

  const summary = document.getElementById("selected-summary");
  if (!selected.length) {
    summary.textContent = "Passe o mouse ou clique em um municipio.";
    return;
  }

  const total = selected.reduce((sum, name) => {
    const row = (appData.pib || []).find(
      (item) => item.nome_municipio === name && Number(item.ano) === selectedYear,
    );
    if (row) return sum + (Number(row.pib) || 0);
    const item = cityLayers.get(name);
    return sum + (item ? getPib(item.properties) : 0);
  }, 0);
  summary.textContent = `${selected.length} cidade(s) selecionada(s): ${currentCityLabel()} - soma PIBpc ${formatCompactPib(total)}`;
}

function updateSummary(features) {
  const values = features.map((feature) => ({
    name: getCityName(feature.properties),
    pib: getPib(feature.properties),
  }));

  const biggest = values.reduce(
    (current, item) => (item.pib > current.pib ? item : current),
    { name: "--", pib: 0 },
  );

  const total = values.reduce((sum, item) => sum + item.pib, 0);
  document.getElementById("total-pib").textContent = formatCompactPib(total);
  document.getElementById("scale-min").textContent = formatCompactPib(
    Math.min(...values.map((item) => item.pib)),
  );
  document.getElementById("scale-mid").textContent = formatCompactPib(total / features.length);
  document.getElementById("scale-max").textContent = formatCompactPib(biggest.pib);
  renderRanking(values);
  renderTrend();
}

function updateOverviewKpi() {
  if (!appData.pib) return;
  if (!selectedYears.size) {
    document.getElementById("total-pib").textContent = "--";
    return;
  }
  const rows = (appData.pib || []).filter((row) => Number(row.ano) === selectedTrendYear);
  const filtered = rows.filter(cityFilter);
  const total = filtered.reduce((sum, row) => sum + (Number(row.pib) || 0), 0);
  document.getElementById("total-pib").textContent = formatCompactPib(total);
}

function renderOverviewRankingFromData() {
  if (!appData.pib) return;
  if (!selectedYears.size) {
    document.getElementById("ranking").innerHTML =
      '<p class="chart-note">Selecione ao menos um ano.</p>';
    return;
  }
  const rows = (appData.pib || []).filter((row) => Number(row.ano) === selectedTrendYear);
  const values = rows.map((row) => ({
    name: row.nome_municipio,
    pib: Number(row.pib) || 0,
  }));
  renderRanking(values);
  syncRankingSelection();
}

function renderRanking(values) {
  const sorted = [...values].sort((a, b) => b.pib - a.pib);
  const max = sorted[0]?.pib || 1;

  document.getElementById("ranking").innerHTML = sorted
    .map(
      (item) => `
        <button class="rank-row" type="button" data-city="${item.name}" aria-pressed="false">
          <div class="rank-name">${item.name}</div>
          <div class="rank-bar" style="width:${Math.max(4, (item.pib / max) * 100)}%"></div>
          <div class="rank-value">${formatCompactPib(item.pib)}</div>
        </button>
      `,
    )
    .join("");

  document.querySelectorAll(".rank-row[data-city]").forEach((row) => {
    row.addEventListener("click", () => {
      toggleMunicipality(row.dataset.city, true);
    });
  });
}

function renderTrend() {
  if (!appData.pib) return;
  const rows = (appData.pib || []).filter(cityFilter).filter(yearFilter);
  const realSeries = aggregateByYear(rows, ["pib"]);
  const years = realSeries.map((row) => row.ano);
  const values = realSeries.map((row) => row.pib / 1000000);

  const title = document.getElementById("overview-trend-title");
  const metrics = document.getElementById("overview-trend-metrics");
  title.textContent = `PIBpc por Ano - ${currentCityLabel()}`;

  if (values.length < 2) {
    metrics.textContent = "Selecione uma cidade ou regiao para acompanhar a evolucao.";
  } else {
    const first = values[0];
    const previous = values[values.length - 2];
    const last = values[values.length - 1];
    const totalGrowth = first ? ((last - first) / first) * 100 : 0;
    const lastGrowth = previous ? ((last - previous) / previous) * 100 : 0;
    metrics.textContent = `${formatPercent(totalGrowth)} desde ${years[0]} | ${formatPercent(lastGrowth)} no ultimo ano`;
  }

  if (!values.length) {
    document.getElementById("trend-chart").innerHTML = "";
    return;
  }

  const width = 620;
  const height = 260;
  const pad = 42;
  const min = Math.max(0, Math.min(...values) * 0.88);
  const max = Math.max(...values) * 1.08;
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / (max - min)) * (height - pad * 2);
    return { x, y, value, year: years[index] };
  });
  const selectedPoint =
    points.find((point) => Number(point.year) === selectedTrendYear) ||
    points[points.length - 1];
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  document.getElementById("trend-chart").innerHTML = `
    <polygon class="trend-area" points="${area}"></polygon>
    <polyline class="trend-line" points="${line}"></polyline>
    <line class="trend-selected-line" x1="${selectedPoint.x}" y1="${pad}" x2="${selectedPoint.x}" y2="${height - pad}"></line>
    ${points
      .map(
        (point, index) => {
          const showLabel =
            index === 0 || index === points.length - 1 || index % labelStep === 0;
          return `
            <circle class="trend-hit" data-year="${point.year}" cx="${point.x}" cy="${point.y}" r="13"></circle>
            ${
              showLabel
                ? `<text class="trend-label" x="${point.x - 24}" y="${point.y - 10}">R$ ${point.value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Bi</text>`
                : ""
            }
            ${showLabel ? `<text class="trend-year" x="${point.x - 14}" y="${height - 12}">${point.year}</text>` : ""}
            ${
              Number(point.year) === selectedTrendYear
                ? `<circle class="trend-selected-point" cx="${point.x}" cy="${point.y}" r="6"></circle>`
                : ""
            }
          `;
        },
      )
      .join("")}
  `;

  document.querySelectorAll(".trend-hit").forEach((point) => {
    point.addEventListener("click", () => {
      selectedTrendYear = Number(point.dataset.year);
      selectedYear = selectedTrendYear;
      if (!selectedYears.has(selectedTrendYear)) {
        selectedYears.add(selectedTrendYear);
      }
      syncYearPicker();
      renderDataTabs();
    });
  });
}

function aggregateByYear(rows, fields) {
  const grouped = new Map();
  rows.forEach((row) => {
    const year = Number(row.ano);
    if (!grouped.has(year)) {
      grouped.set(year, { ano: year });
      fields.forEach((field) => {
        grouped.get(year)[field] = 0;
      });
    }
    fields.forEach((field) => {
      grouped.get(year)[field] += Number(row[field]) || 0;
    });
  });
  return [...grouped.values()].sort((a, b) => a.ano - b.ano);
}

function averageByYear(rows, field) {
  const grouped = new Map();
  rows.forEach((row) => {
    const year = Number(row.ano);
    if (!grouped.has(year)) grouped.set(year, { ano: year, total: 0, count: 0 });
    grouped.get(year).total += Number(row[field]) || 0;
    grouped.get(year).count += 1;
  });
  return [...grouped.values()]
    .map((item) => ({ ano: item.ano, [field]: item.count ? item.total / item.count : 0 }))
    .sort((a, b) => a.ano - b.ano);
}

function aggregatePibPerCapitaByYear(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const year = Number(row.ano);
    if (!grouped.has(year)) grouped.set(year, { ano: year, pib: 0, populacao: 0 });
    grouped.get(year).pib += Number(row.pib) || 0;
    grouped.get(year).populacao += Number(row.populacao) || 0;
  });
  return [...grouped.values()]
    .map((item) => ({
      ano: item.ano,
      pib_per_capita: item.populacao ? (item.pib * 1000) / item.populacao : 0,
    }))
    .sort((a, b) => a.ano - b.ano);
}

function addPctVariation(series, sourceField, targetField) {
  return series.map((row, index) => {
    if (index === 0) return { ...row, [targetField]: null };
    const previous = Number(series[index - 1][sourceField]) || 0;
    const current = Number(row[sourceField]) || 0;
    return {
      ...row,
      [targetField]: previous ? ((current - previous) / previous) * 100 : null,
    };
  });
}

function lineChart(containerId, rows, field, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const data = rows.filter((row) => Number.isFinite(Number(row[field])));
  if (!data.length) {
    container.innerHTML = `<p class="chart-note">Sem dados para ${escapeHtml(currentCityLabel())}.</p>`;
    return;
  }

  const width = 760;
  const height = 260;
  const padX = 54;
  const padY = 32;
  const numericYears = data.map((row) => Number(row.ano));
  const useCategories = numericYears.some((year) => Number.isNaN(year));
  const minYear = useCategories ? 0 : Math.min(...numericYears);
  const maxYear = useCategories ? data.length - 1 : Math.max(...numericYears);
  const values = data.map((row) => Number(row[field]) || 0);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(...values, 1);
  const valueRange = maxValue - minValue || 1;
  const points = data.map((row, index) => {
    const year = useCategories ? index : Number(row.ano);
    const value = Number(row[field]) || 0;
    const x =
      minYear === maxYear
        ? width / 2
        : padX + ((year - minYear) / (maxYear - minYear)) * (width - padX * 2);
    const y = height - padY - ((value - minValue) / valueRange) * (height - padY * 2);
    return { x, y, year: row.ano, value };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${padX},${height - padY} ${polyline} ${width - padX},${height - padY}`;
  const step = Math.max(1, Math.ceil(points.length / 7));

  container.innerHTML = `
    <p class="chart-title">${escapeHtml(options.title || "")}</p>
    <svg viewBox="0 0 ${width} ${height}" role="img">
      <polygon class="area-primary" points="${area}"></polygon>
      <polyline class="${options.secondary ? "line-secondary" : "line-primary"}" points="${polyline}"></polyline>
      ${points
        .map(
          (point, index) => `
            <circle cx="${point.x}" cy="${point.y}" r="4" fill="${options.secondary ? "#02a65c" : "#2681c2"}"></circle>
            ${
              index % step === 0 || index === points.length - 1
                ? `<text class="axis-label" x="${point.x - 16}" y="${height - 8}">${point.year}</text>`
                : ""
            }
            ${
              index === points.length - 1
                ? `<text class="point-label" x="${point.x - 80}" y="${point.y - 10}">${escapeHtml(options.format ? options.format(point.value) : formatterNumber.format(point.value))}</text>`
                : ""
            }
          `,
        )
        .join("")}
    </svg>
  `;
}

function zeroBarChart(containerId, rows, field, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const data = rows.filter((row) => Number.isFinite(Number(row[field])));
  if (!data.length) {
    container.innerHTML = `<p class="chart-note">Sem dados para ${escapeHtml(currentCityLabel())}.</p>`;
    return;
  }

  const width = 760;
  const height = 260;
  const padX = 54;
  const padY = 34;
  const values = data.map((row) => Number(row[field]) || 0);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const range = maxValue - minValue || 1;
  const zeroY = height - padY - ((0 - minValue) / range) * (height - padY * 2);
  const barGap = 8;
  const barWidth = Math.max(12, (width - padX * 2) / data.length - barGap);
  const step = Math.max(1, Math.ceil(data.length / 8));

  container.innerHTML = `
    <p class="chart-title">${escapeHtml(options.title || "")}</p>
    <svg viewBox="0 0 ${width} ${height}" role="img">
      <line x1="${padX}" y1="${zeroY}" x2="${width - padX}" y2="${zeroY}" stroke="#e4774b" stroke-width="2"></line>
      ${data
        .map((row, index) => {
          const value = Number(row[field]) || 0;
          const x = padX + index * (barWidth + barGap);
          const y = height - padY - ((value - minValue) / range) * (height - padY * 2);
          const top = Math.min(y, zeroY);
          const barHeight = Math.max(2, Math.abs(zeroY - y));
          const color = value >= 0 ? "#4b9ba0" : "#d95a4f";
          return `
            <rect x="${x}" y="${top}" width="${barWidth}" height="${barHeight}" fill="${color}"></rect>
            <text class="point-label" x="${x - 2}" y="${top - 7}">${escapeHtml(options.format ? options.format(value) : formatterNumber.format(value))}</text>
            ${
              index % step === 0 || index === data.length - 1
                ? `<text class="axis-label" x="${x - 4}" y="${height - 10}">${escapeHtml(row.ano)}</text>`
                : ""
            }
          `;
        })
        .join("")}
    </svg>
  `;
}

function tableHtml(headers, rows) {
  return `
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("")}
    </tbody>
  `;
}

function renderIncomeTab() {
  const rows = (appData.pib || []).filter(cityFilter).filter(yearFilter);
  const pibSeries = aggregateByYear(rows, ["pib"]);
  const perCapitaSeries =
    selectedCityNames.size === 1
      ? rows.sort((a, b) => a.ano - b.ano)
      : aggregatePibPerCapitaByYear(rows);

  lineChart("income-pib-chart", pibSeries, "pib", {
    title: `PIB municipal - ${currentCityLabel()}`,
    format: formatCompactPib,
  });
  lineChart("income-per-capita-chart", perCapitaSeries, "pib_per_capita", {
    title: `PIB per capita - ${currentCityLabel()}`,
    secondary: true,
    format: formatMoney,
  });
  zeroBarChart("income-growth-chart", addPctVariation(pibSeries, "pib", "crescimento"), "crescimento", {
    title: `Crescimento anual do PIB - ${currentCityLabel()}`,
    format: (value) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
  });

  const yearRows = rows
    .sort((a, b) => b.pib - a.pib)
    .slice(0, selectedCityNames.size ? 60 : 40)
    .map((row) => [
      row.nome_municipio,
      row.ano,
      formatCompactPib(row.pib),
      formatMoney(row.pib_per_capita),
      formatPercent(row.crescimento_pib_pct),
    ]);

  document.getElementById("income-table").innerHTML = tableHtml(
    ["municipio", "ano", "pib", "pib_per_capita", "crescimento_pib_pct"],
    yearRows,
  );
}

function renderStructureTab() {
  const rows = (appData.structure || []).filter(cityFilter).filter(yearFilter);
  const series = aggregateByYear(rows, ["va_industria", "va_servicos", "va_adespss"]);
  const data = series.slice(-20);
  const container = document.getElementById("structure-chart");
  const width = 760;
  const height = 280;
  const barGap = 8;
  const pad = 36;
  const barWidth = Math.max(14, (width - pad * 2) / Math.max(1, data.length) - barGap);

  container.innerHTML = `
    <p class="chart-title">Estrutura economica - ${escapeHtml(currentCityLabel())}</p>
    <svg viewBox="0 0 ${width} ${height}" role="img">
      ${data
        .map((row, index) => {
          const total =
            (Number(row.va_industria) || 0) +
            (Number(row.va_servicos) || 0) +
            (Number(row.va_adespss) || 0);
          const industria = total ? ((Number(row.va_industria) || 0) / total) * 190 : 0;
          const servicos = total ? ((Number(row.va_servicos) || 0) / total) * 190 : 0;
          const adm = total ? ((Number(row.va_adespss) || 0) / total) * 190 : 0;
          const x = pad + index * (barWidth + barGap);
          const base = height - 44;
          return `
            <rect class="bar-blue" x="${x}" y="${base - industria}" width="${barWidth}" height="${industria}"></rect>
            <rect class="bar-green" x="${x}" y="${base - industria - servicos}" width="${barWidth}" height="${servicos}"></rect>
            <rect class="bar-red" x="${x}" y="${base - industria - servicos - adm}" width="${barWidth}" height="${adm}"></rect>
            ${index % 2 === 0 ? `<text class="axis-label" x="${x - 4}" y="${height - 12}">${row.ano}</text>` : ""}
          `;
        })
        .join("")}
      <text class="axis-label" x="42" y="24">Industria / Servicos / Adm. publica</text>
    </svg>
  `;

  const tableRows = rows
    .sort((a, b) => b.va - a.va)
    .slice(0, selectedCityNames.size ? 60 : 40)
    .map((row) => [
      row.nome_municipio,
      row.ano,
      formatCompactPib(row.va),
      formatPercent(row.participacao_industria_pct),
      formatPercent(row.participacao_servicos_pct),
      formatPercent(row.participacao_administracao_publica_pct),
    ]);

  document.getElementById("structure-table").innerHTML = tableHtml(
    ["municipio", "ano", "va", "industria_pct", "servicos_pct", "administracao_publica_pct"],
    tableRows,
  );
}

function renderJobsTab() {
  const rows = (appData.rais || []).filter(cityFilter).filter(yearFilter);
  const series = aggregateByYear(rows, ["emprego_formal_total"]);
  lineChart("jobs-chart", series, "emprego_formal_total", {
    title: `Emprego formal - ${currentCityLabel()}`,
    format: formatterNumber.format,
  });
  zeroBarChart(
    "jobs-variation-chart",
    addPctVariation(series, "emprego_formal_total", "variacao_emprego"),
    "variacao_emprego",
    {
      title: `Variacao anual do emprego formal - ${currentCityLabel()}`,
      format: (value) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
    },
  );

  const sectorRows = (appData.raisSector || [])
    .filter(cityFilter)
    .filter(yearFilter);
  const sectors = new Map();
  sectorRows.forEach((row) => {
    sectors.set(row.setor, (sectors.get(row.setor) || 0) + (Number(row.emprego_formal_total) || 0));
  });
  const top = [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = top[0]?.[1] || 1;
  document.getElementById("jobs-sector-ranking").innerHTML = top.length
    ? top
        .map(
          ([name, value]) => `
            <div class="mini-rank-row">
              <div>${escapeHtml(name)}</div>
              <div class="mini-rank-bar" style="width:${Math.max(3, (value / max) * 100)}%"></div>
              <strong>${formatterNumber.format(value)}</strong>
            </div>
          `,
        )
        .join("")
    : `<p class="chart-note">Sem dados setoriais para a selecao atual.</p>`;
}

function renderMovementTab() {
  const rows = (appData.caged || []).filter(cityFilter).filter(yearFilter);
  const seriesRows = rows;
  const grouped = new Map();
  seriesRows.forEach((row) => {
    const key = `${row.ano}-${String(row.mes).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) || 0) + (Number(row.saldo_movimentacao) || 0));
  });
  const series = [...grouped.entries()].map(([ano, saldo_movimentacao]) => ({
    ano,
    saldo_movimentacao,
  }));

  lineChart("movement-chart", series, "saldo_movimentacao", {
    title: `Saldo mensal do CAGED - ${currentCityLabel()}`,
    secondary: true,
    format: formatterNumber.format,
  });

  zeroBarChart(
    "movement-year-balance-chart",
    aggregateByYear(rows, ["saldo_movimentacao"]),
    "saldo_movimentacao",
    {
      title: `Saldo anual do CAGED - ${currentCityLabel()}`,
      format: formatterNumber.format,
    },
  );

  const tableRows = rows
    .sort((a, b) => String(b.data_referencia).localeCompare(String(a.data_referencia)))
    .slice(0, 12)
    .map((row) => [
      row.nome_municipio,
      row.data_referencia,
      row.admissoes,
      row.desligamentos,
      row.saldo_movimentacao,
      formatMoney(row.salario_medio_admissoes),
    ]);

  document.getElementById("movement-table").innerHTML = tableHtml(
    ["municipio", "mes", "admissoes", "desligamentos", "saldo", "salario medio"],
    tableRows,
  );
}

function renderIpcTab() {
  const ipcaRows = (appData.bcbMacro || [])
    .filter((row) => row.codigo_sgs === 433)
    .map((row) => ({
      ano: row.data.slice(3),
      valor: Number(row.valor) || 0,
    }));

  zeroBarChart("ipc-bcb-chart", ipcaRows, "valor", {
    title: "IPCA mensal - Banco Central/SGS",
    format: (value) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`,
  });
}

function renderHomeTab() {
  const selectedCityCount = selectedCityNames.size || allCityNames.length;
  const yearRows = (appData.pib || []).filter((row) => Number(row.ano) === selectedTrendYear);
  const filteredYearRows = yearRows.filter(cityFilter);
  const pibTotal = filteredYearRows.reduce((sum, row) => sum + (Number(row.pib) || 0), 0);
  const bestCity = [...yearRows].sort((a, b) => (Number(b.pib) || 0) - (Number(a.pib) || 0))[0];

  const structureRows = (appData.structure || [])
    .filter(cityFilter)
    .filter((row) => Number(row.ano) === selectedTrendYear);
  const vabTotal = structureRows.reduce((sum, row) => sum + (Number(row.va) || 0), 0);

  const raisRows = (appData.rais || [])
    .filter(cityFilter)
    .filter((row) => Number(row.ano) === selectedTrendYear);
  const jobsTotal = raisRows.reduce(
    (sum, row) => sum + (Number(row.emprego_formal_total) || 0),
    0,
  );

  const cagedRows = (appData.caged || [])
    .filter(cityFilter)
    .filter((row) => Number(row.ano) === selectedTrendYear);
  const cagedBalance = cagedRows.reduce(
    (sum, row) => sum + (Number(row.saldo_movimentacao) || 0),
    0,
  );

  const municipalPopulation = (appData.populationMunicipal || []).filter(cityFilter);
  const latestPopulationYear = Math.max(
    ...municipalPopulation.map((row) => Number(row.ano)).filter(Boolean),
  );
  const latestMunicipalPopulation = Number.isFinite(latestPopulationYear)
    ? municipalPopulation
        .filter((row) => Number(row.ano) === latestPopulationYear)
        .reduce((sum, row) => sum + (Number(row.populacao_estimada) || 0), 0)
    : 0;
  const demographyRows = [...(appData.demography || [])].sort((a, b) => a.ano - b.ano);
  const latestPopulation = demographyRows[demographyRows.length - 1];
  const integratedCount = (appData.indicatorControl || []).filter(
    (row) => row.situacao === "Integrado",
  ).length;
  const partialCount = (appData.indicatorControl || []).filter(
    (row) => row.situacao === "Parcial",
  ).length;

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  setText("home-selected-cities", formatterNumber.format(selectedCityCount));
  setText("home-pib-total", pibTotal ? formatCompactPib(pibTotal) : "--");
  setText("home-vab-total", vabTotal ? formatCompactPib(vabTotal) : "--");
  setText("home-jobs-total", jobsTotal ? formatterNumber.format(jobsTotal) : "--");
  setText("home-caged-balance", formatterNumber.format(cagedBalance));
  setText(
    "home-population-rn",
    latestMunicipalPopulation
      ? formatterNumber.format(latestMunicipalPopulation)
      : latestPopulation
        ? `${Number(latestPopulation.populacao_mil_pessoas).toLocaleString("pt-BR")} mil`
        : "--",
  );
  setText("home-best-city", bestCity?.nome_municipio || "--");
  setText("home-data-status", `${integratedCount} integrados + ${partialCount} parcial`);

  const pibSeries = aggregateByYear(
    (appData.pib || []).filter(cityFilter).filter(yearFilter),
    ["pib"],
  );
  lineChart("home-pib-chart", pibSeries, "pib", {
    title: `PIBpc - ${currentCityLabel()}`,
    format: formatCompactPib,
  });

  const top = filteredYearRows
    .map((row) => ({ name: row.nome_municipio, value: Number(row.pib) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const max = top[0]?.value || 1;
  const topContainer = document.getElementById("home-top-cities");
  if (topContainer) {
    topContainer.innerHTML = top.length
      ? top
          .map(
            (row) => `
              <button class="mini-rank-row mini-rank-button" type="button" data-city="${escapeHtml(row.name)}">
                <div>${escapeHtml(row.name)}</div>
                <div class="mini-rank-bar" style="width:${Math.max(3, (row.value / max) * 100)}%"></div>
                <strong>${formatCompactPib(row.value)}</strong>
              </button>
            `,
          )
          .join("")
      : `<p class="chart-note">Selecione ao menos um ano.</p>`;

    topContainer.querySelectorAll(".mini-rank-button[data-city]").forEach((button) => {
      button.addEventListener("click", () => toggleMunicipality(button.dataset.city, true));
    });
  }

  const statusTable = document.getElementById("home-indicator-status");
  if (statusTable) {
    const rows = (appData.indicatorControl || []).map((row) => [
      row.aba,
      row.indicador,
      row.nivel,
      row.situacao,
    ]);
    statusTable.innerHTML = tableHtml(["aba", "indicador", "nivel", "situacao"], rows);
  }
}

function renderDemographyTab() {
  const municipalRows = (appData.populationMunicipal || []).filter(cityFilter).filter(yearFilter);
  const series = aggregateByYear(municipalRows, ["populacao_estimada"]);
  const rows = [...(appData.demography || [])].sort((a, b) => a.ano - b.ano);
  const latest = series[series.length - 1] || rows[rows.length - 1];
  const current = document.getElementById("demography-current-population");
  if (current) {
    current.textContent = latest?.populacao_estimada
      ? formatterNumber.format(latest.populacao_estimada)
      : latest
      ? `${Number(latest.populacao_mil_pessoas).toLocaleString("pt-BR")} mil`
      : "--";
  }

  lineChart("demography-population-chart", series.length ? series : rows, series.length ? "populacao_estimada" : "populacao_mil_pessoas", {
    title: `Populacao estimada - ${currentCityLabel()}`,
    secondary: true,
    format: formatterNumber.format,
  });

  const table = document.getElementById("demography-table");
  if (table) {
    const latestTableYear = Math.max(
      ...municipalRows.map((row) => Number(row.ano)).filter(Boolean),
    );
    const tableRows = municipalRows
      .filter((row) => Number(row.ano) === latestTableYear)
      .sort((a, b) => b.populacao_estimada - a.populacao_estimada)
      .slice(0, selectedCityNames.size ? 80 : 40)
      .map((row) => [
        row.nome_municipio,
        row.ano,
        formatterNumber.format(row.populacao_estimada),
        row.fonte,
      ]);

    table.innerHTML = tableHtml(
      ["municipio", "ano", "populacao_estimada", "fonte"],
      tableRows.length
        ? tableRows
        : rows.map((row) => [
            row.localidade_nome,
            row.ano,
            `${Number(row.populacao_mil_pessoas).toLocaleString("pt-BR")} mil`,
            row.fonte,
          ]),
    );
  }
}

function renderIndicatorControl() {
  const table = document.getElementById("indicator-control-table");
  if (!table) return;

  const rows = appData.indicatorControl || [];
  table.innerHTML = tableHtml(
    ["aba", "indicador", "fonte", "nivel", "periodicidade", "situacao", "observacao"],
    rows.map((row) => [
      row.aba,
      row.indicador,
      row.fonte,
      row.nivel,
      row.periodicidade,
      row.situacao,
      row.observacao,
    ]),
  );
}

function renderDataTabs() {
  if (!appData.pib) return;
  renderHomeTab();
  updateOverviewKpi();
  updateSelectionSummary();
  renderOverviewRankingFromData();
  renderTrend();
  renderIncomeTab();
  renderStructureTab();
  renderJobsTab();
  renderMovementTab();
  renderIpcTab();
  renderDemographyTab();
  renderIndicatorControl();
}

function syncYearPicker() {
  const toggle = document.getElementById("year-picker-toggle");
  if (toggle) {
    const years = [...selectedYears].sort((a, b) => a - b);
    toggle.textContent = !years.length
      ? "Nenhum ano selecionado"
      : years.length === 1
        ? String(years[0])
        : `${years.length} anos selecionados`;
  }

  document.querySelectorAll(".year-checkbox").forEach((input) => {
    input.checked = selectedYears.has(Number(input.value));
  });
}

function clearSelection() {
  selectedLayer = null;
  selectedCityNames.clear();
  updateSelectionSummary();
  syncMunicipalitySelect();
  document.querySelectorAll(".rank-row").forEach((row) => {
    row.classList.remove("is-selected");
    row.setAttribute("aria-pressed", "false");
  });
  mapEntries.forEach((entry) => {
    if (entry.layer) entry.layer.resetStyle();
    entry.selectedLayer = null;
    if (defaultView) entry.map.fitBounds(defaultView, { padding: [16, 16] });
  });
  renderDataTabs();
}

function setupNavigation() {
  const buttons = document.querySelectorAll(".side-nav button[data-view]");
  const views = document.querySelectorAll(".view");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.view;

      buttons.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");

      views.forEach((view) => {
        view.classList.toggle("is-active", view.id === `view-${target}`);
      });

      if (defaultView) {
        setTimeout(() => {
          mapEntries.forEach((entry) => {
            entry.map.invalidateSize();
            entry.map.fitBounds(defaultView, { padding: [16, 16] });
          });
        }, 50);
      }
    });
  });
}

function registerCityLayer(name, layerItem, parentEntry, properties) {
  if (!cityLayers.has(name)) {
    cityLayers.set(name, { properties, layers: [] });
  }

  cityLayers.get(name).layers.push({
    entry: parentEntry,
    layer: layerItem,
  });
}

function resetSelectedLayers() {
  mapEntries.forEach((entry) => {
    if (entry.layer) entry.layer.resetStyle();
    entry.selectedLayer = null;
  });
}

function markLayer(entry, layerItem) {
  entry.selectedLayer = layerItem;
  layerItem.setStyle({
    color: "#1aff38",
    weight: 2.6,
    fillOpacity: 1,
  });
  layerItem.bringToFront();
}

function syncMunicipalitySelect() {
  document.querySelectorAll(".city-checkbox").forEach((input) => {
    input.checked = selectedCityNames.has(input.value);
  });
  document.querySelectorAll(".region-checkbox").forEach((input) => {
    const cities = citiesForRegion(input.value);
    input.checked = cities.length > 0 && cities.every((city) => selectedCityNames.has(city));
    input.indeterminate =
      cities.some((city) => selectedCityNames.has(city)) &&
      !cities.every((city) => selectedCityNames.has(city));
  });
}

function syncRankingSelection() {
  document.querySelectorAll(".rank-row[data-city]").forEach((row) => {
    const selected = selectedCityNames.has(row.dataset.city);
    row.classList.toggle("is-selected", selected);
    row.setAttribute("aria-pressed", String(selected));
  });
}

function applySelection(fit = false) {
  resetSelectedLayers();
  selectedLayer = null;

  selectedCityNames.forEach((name) => {
    const item = cityLayers.get(name);
    if (!item) return;
    if (!selectedLayer) selectedLayer = item.layers[0]?.layer || null;
    item.layers.forEach(({ entry, layer }) => {
      markLayer(entry, layer);
    });
  });

  syncMunicipalitySelect();
  syncRankingSelection();
  updateSelectionSummary();
  renderDataTabs();

  if (fit && selectedCityNames.size) {
    mapEntries.forEach((entry) => {
      let bounds = null;
      selectedCityNames.forEach((name) => {
        const item = cityLayers.get(name);
        const match = item?.layers.find((layerInfo) => layerInfo.entry === entry);
        if (!match) return;
        bounds = bounds ? bounds.extend(match.layer.getBounds()) : match.layer.getBounds();
      });
      if (bounds) {
        entry.map.invalidateSize();
        entry.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 8 });
      }
    });
  }
}

function toggleMunicipality(name, fit = false) {
  if (!cityLayers.has(name)) return;

  if (selectedCityNames.has(name)) {
    selectedCityNames.delete(name);
  } else {
    selectedCityNames.add(name);
  }

  if (!selectedCityNames.size) {
    clearSelection();
    return;
  }

  applySelection(fit);
}

function populateMunicipalityFilter(features) {
  allCityNames = features
    .map((feature) => getCityName(feature.properties))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  cityRegionMap = new Map(allCityNames.map((name) => [name, regionForCity(name)]));
  renderRegionPicker();
  renderCityPicker();

  document.getElementById("city-search").addEventListener("input", renderCityPicker);
  document.getElementById("municipio-picker-toggle").addEventListener("click", () => {
    document.getElementById("municipio-picker").classList.toggle("is-open");
  });
  document.getElementById("select-all-cities").addEventListener("click", () => {
    allCityNames.forEach((name) => selectedCityNames.add(name));
    applySelection(true);
  });
  document.getElementById("deselect-all-cities").addEventListener("click", clearSelection);
  document.addEventListener("click", (event) => {
    const picker = document.getElementById("municipio-picker");
    if (!picker.contains(event.target)) picker.classList.remove("is-open");
  });
  updateSelectionSummary();
}

function citiesForRegion(region) {
  return allCityNames.filter((city) => cityRegionMap.get(city) === region);
}

function renderRegionPicker() {
  const regionsFromData = [...new Set(allCityNames.map((city) => cityRegionMap.get(city)))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const regions = FALLBACK_REGIONS.concat(
    regionsFromData.filter((region) => !FALLBACK_REGIONS.includes(region)),
  );

  document.getElementById("region-list").innerHTML = regions
    .map(
      (region) => `
        <label class="picker-option">
          <input class="region-checkbox" type="checkbox" value="${escapeHtml(region)}" />
          <span>${escapeHtml(region)}</span>
        </label>
      `,
    )
    .join("");

  document.querySelectorAll(".region-checkbox").forEach((input) => {
    input.addEventListener("change", () => {
      const cities = citiesForRegion(input.value);
      cities.forEach((city) => {
        if (input.checked) selectedCityNames.add(city);
        else selectedCityNames.delete(city);
      });

      if (!selectedCityNames.size) clearSelection();
      else applySelection(true);
    });
  });
  syncMunicipalitySelect();
}

function renderCityPicker() {
  const term = normalizeText(document.getElementById("city-search").value);
  const visible = allCityNames.filter((name) => normalizeText(name).includes(term));

  document.getElementById("city-list").innerHTML = visible
    .map(
      (name) => `
        <label class="picker-option">
          <input class="city-checkbox" type="checkbox" value="${escapeHtml(name)}" />
          <span>${escapeHtml(name)}</span>
        </label>
      `,
    )
    .join("");

  document.querySelectorAll(".city-checkbox").forEach((input) => {
    input.checked = selectedCityNames.has(input.value);
    input.addEventListener("change", () => {
      if (input.checked) selectedCityNames.add(input.value);
      else selectedCityNames.delete(input.value);

      if (!selectedCityNames.size) clearSelection();
      else applySelection(true);
    });
  });
  syncMunicipalitySelect();
}

async function loadDatasets() {
  const results = await Promise.all(
    Object.entries(DATASETS).map(async ([key, url]) => {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Base opcional nao encontrada: ${url}`);
        return [key, []];
      }
      return [key, await response.json()];
    }),
  );
  appData = Object.fromEntries(results);
}

function populateYearFilter() {
  const years = [...new Set((appData.pib || []).map((row) => Number(row.ano)))]
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!years.length) years.push(2021);
  selectedYear = years.includes(2021) ? 2021 : years[0];
  selectedTrendYear = selectedYear;
  selectedYears.clear();
  selectedYears.add(selectedYear);

  document.getElementById("year-list").innerHTML = years
    .map(
      (year) => `
        <label class="picker-option">
          <input class="year-checkbox" type="checkbox" value="${year}" />
          <span>${year}</span>
        </label>
      `,
    )
    .join("");

  document.getElementById("year-picker-toggle").addEventListener("click", () => {
    document.getElementById("year-picker").classList.toggle("is-open");
  });
  document.getElementById("select-all-years").addEventListener("click", () => {
    years.forEach((year) => selectedYears.add(year));
    selectedYear = Math.max(...selectedYears);
    selectedTrendYear = selectedYear;
    syncYearPicker();
    renderDataTabs();
  });
  document.getElementById("deselect-all-years").addEventListener("click", () => {
    selectedYears.clear();
    syncYearPicker();
    renderDataTabs();
  });
  document.querySelectorAll(".year-checkbox").forEach((input) => {
    input.checked = selectedYears.has(Number(input.value));
    input.addEventListener("change", () => {
      const year = Number(input.value);
      if (input.checked) selectedYears.add(year);
      else selectedYears.delete(year);

      if (selectedYears.size) {
        selectedYear = Math.max(...selectedYears);
        selectedTrendYear = selectedYear;
      }

      syncYearPicker();
      renderDataTabs();
    });
  });
  document.addEventListener("click", (event) => {
    const picker = document.getElementById("year-picker");
    if (!picker.contains(event.target)) picker.classList.remove("is-open");
  });
  syncYearPicker();
}

async function init() {
  const loading = document.getElementById("loading");

  try {
    const [response] = await Promise.all([fetch(DATA_URL), loadDatasets()]);
    if (!response.ok) {
      throw new Error(`Arquivo nao encontrado: ${DATA_URL}`);
    }

    const geojson = await response.json();
    const features = geojson.features || [];
    const pibValues = features.map((feature) => getPib(feature.properties));
    const minPib = Math.min(...pibValues);
    const maxPib = Math.max(...pibValues);
    cityLayers.clear();

    function buildMunicipalityLayer(entry) {
      const layer = L.geoJSON(geojson, {
        style(feature) {
          const pib = getPib(feature.properties);
          return {
            className: "municipio-shape",
            color: "#ffffff",
            weight: 0.8,
            fillColor: colorForPib(pib, minPib, maxPib),
            fillOpacity: 0.86,
            opacity: 0.92,
          };
        },
        onEachFeature(feature, layerItem) {
          const name = getCityName(feature.properties);
          layerItem.options.interactive = true;
          registerCityLayer(name, layerItem, entry, feature.properties);

          layerItem.bindTooltip(tooltipContent(feature.properties), {
            className: "city-tooltip",
            sticky: true,
            direction: "top",
          });

          layerItem.on({
            mouseover(event) {
              event.target.setStyle({
                color: "#1aff38",
                weight: 2.2,
                fillOpacity: 1,
              });
              event.target.bringToFront();
              updateSelectedCity(feature.properties);
            },
            mouseout(event) {
              if (!selectedCityNames.has(name)) {
                layer.resetStyle(event.target);
              }
              if (selectedCityNames.size) updateSelectionSummary();
            },
            click() {
              toggleMunicipality(name, false);
            },
          });
        },
      }).addTo(entry.map);

      entry.layer = layer;
      return layer;
    }

    const layer = buildMunicipalityLayer(mapEntries[0]);
    mapEntries.slice(1).forEach(buildMunicipalityLayer);

    const rnBounds = layer.getBounds();
    geoLayer = layer;
    defaultView = rnBounds;
    mapEntries.forEach((entry) => {
      entry.map.invalidateSize();
      entry.map.fitBounds(rnBounds, { padding: [16, 16] });
    });
    setTimeout(() => {
      mapEntries.forEach((entry) => {
        entry.map.invalidateSize();
        entry.map.fitBounds(rnBounds, { padding: [16, 16] });
      });
    }, 100);

    updateSummary(features);
    populateMunicipalityFilter(features);
    populateYearFilter();
    renderDataTabs();
    document.getElementById("clear-selection").addEventListener("click", clearSelection);
    loading.remove();
  } catch (error) {
    loading.textContent =
      "Coloque o arquivo mapa_pib_rn_final.geojson nesta pasta e recarregue.";
    loading.classList.add("is-error");
    console.error(error);
    map.setView([-5.8, -36.6], 7);
  }
}

setupNavigation();
init();
