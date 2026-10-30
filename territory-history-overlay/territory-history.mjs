import { bindHighlightSelection, highlightAction } from "./highlights.mjs";
// A reading of available source records, never a reconstruction of episodes.
const SOURCES = {
  egif: { label: "EGIF", count: "egif_record_count", unit: "registros", gif: "egif_administrative_gif_count" },
  icv: { label: "ICV", count: "icv_fire_record_count", unit: "registros", gif: "icv_gif_count" },
  esfire30: { label: "ESFire30", count: "esfire30_perimeter_count", unit: "geometrías" },
  effis: { label: "EFFIS", count: "effis_perimeter_count", unit: "perímetros" },
};
export const EMPTY_HISTORY = "No hay registros disponibles para esta fuente y periodo en el Atlas.";
const number = value => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value);
const area = value => {
  const parts = value.toFixed(2).split(".");
  return `${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${parts[1]}`;
};
const period = (from, to) => from === to ? `En ${from}` : `Entre ${from} y ${to}`;
const sourceOf = metric => String(metric || "").split("_")[0];
export function historyKey(state) {
  return JSON.stringify([state.territory_scope, state.autonomous_community_id, state.province_id, state.municipality_id,
    state.from, state.to, state.egif_visible, state.icv_visible, state.esfire30_visible, state.effis_visible, state.filters || []]);
}
function values(summary, id, from, to, field = "values") {
  const metric = (summary.metrics || []).find(row => row.metric_id === id);
  if (!metric || !Array.isArray(metric[field])) return null;
  const rows = [];
  for (let year = from; year <= to; year++) {
    const value = metric[field][year - summary.year_axis.from];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    rows.push({ year, value });
  }
  return rows;
}
const sum = rows => rows.reduce((total, row) => total + row.value, 0);

export function composeHistory({ territory, state, metricId, highlight = null }) {
  const source = sourceOf(metricId), config = SOURCES[source];
  const result = { source, metric_id: metricId, messages: [], status: "empty", note: "", context: "Lectura del periodo seleccionado" };
  if (!config) return { ...result, note: EMPTY_HISTORY };
  result.context += ` · ${config.label} · ${state.from === state.to ? state.from : `${state.from}–${state.to}`}`;
  if (!state[`${source}_visible`]) return { ...result, status: "inactive", note: `La fuente ${config.label} está desactivada.` };
  const summary = (territory.source_summaries || []).find(row => row.source_id === source);
  if (!summary || !summary.coverage || summary.coverage.status !== "available") return { ...result, note: EMPTY_HISTORY };
  if (summary.filtered_summary_mode === "HIDE_WHILE_FILTERED") return { ...result, status: "filtered-unavailable", note: "No hay un resumen exacto disponible para estos filtros; no se muestran cifras sin filtrar." };
  const from = Math.max(Number(state.from), summary.year_axis.from, summary.coverage.from);
  const to = Math.min(Number(state.to), summary.year_axis.to, summary.coverage.to);
  if (from > to) return { ...result, note: EMPTY_HISTORY };
  result.effective_period = [from, to];
  const countId = metricId === "icv_perimeter_count" ? metricId : config.count;
  const rows = values(summary, countId, from, to);
  if (!rows) return { ...result, status: "unknown", note: "El recuento no está disponible con suficiente detalle para este periodo." };
  const total = sum(rows);
  if (!total) return { ...result, note: EMPTY_HISTORY };
  const unit = countId === "icv_perimeter_count" ? "perímetros" : config.unit;
  const noun = total === 1 ? ({ registros: "registro", geometrías: "geometría", perímetros: "perímetro" })[unit] : unit;
  const qualification = source === "esfire30"
    ? `${total === 1 ? "relacionada" : "relacionadas"} con este territorio en la cobertura disponible`
    : `${total === 1 ? "asignado" : "asignados"} a este territorio`;
  const add = (type, text, metric, extra = {}) => result.messages.push({ type, text, source, metric_id: metric, period: [from, to], ...extra });
  add("A", `${period(from, to)}, ${config.label} reúne ${number(total)} ${noun} ${qualification}.`, countId);
  // When an area tab is selected, do not describe counts as "that series".
  const positive = rows.filter(row => row.value > 0);
  const maximum = Math.max(...rows.map(row => row.value));
  const peaks = positive.filter(row => row.value === maximum);
  if (metricId === countId && Number(state.from) < Number(state.to) && positive.length >= 2 && peaks.length < positive.length && peaks.length <= 3) {
    const years = peaks.map(row => row.year);
    const yearText = years.length === 1 ? String(years[0]) : `${years.slice(0, -1).join(", ")} y ${years[years.length - 1]}`;
    add("B", `En esa serie, el mayor recuento anual corresponde a ${yearText}: ${number(maximum)} ${unit} por año.`, countId);
  }
  if (config.gif && highlight && highlight.status === "complete" && highlight.source_id === source) {
    const items = (highlight.items || []).filter(row => typeof row.reported_forest_area_ha === "number" && Number.isFinite(row.reported_forest_area_ha)
      && row.reported_forest_area_ha > 0 && Number.isInteger(row.year) && row.year >= from && row.year <= to);
    items.sort((a, b) => b.reported_forest_area_ha - a.reported_forest_area_ha);
    if (items.length) {
      const row = items[0];
      add("C", `Un registro ${config.label} de ${row.year} alcanza el máximo de superficie forestal declarada conocida del periodo: ${area(row.reported_forest_area_ha)} ha.`, "reported_forest_area_ha", { record_id: row.record_id || row.fire_id });
    }
  }
  const sourceFilters = (state.filters || []).filter(row => row.source === source);
  const redundantGif = sourceFilters.some(row => row.filter_id === `${source}_gif` && row.value === true
    || row.filter_id === `${source}_min_area` && Number(row.value) >= 500);
  const gif = config.gif && values(summary, config.gif, from, to);
  const unknown = config.gif && values(summary, config.gif, from, to, "unknown_value_count");
  // Filtered runtime replaces GIF values but not the original unknown metadata:
  // require known surface flags of the exact result rather than trusting that metadata.
  const classificationKnown = summary.filtered_summary_mode === "EXACT_RUNTIME"
    ? summary.history_gif_known === true : unknown && sum(unknown) === 0;
  if (gif && sum(gif) > 0 && classificationKnown && !redundantGif) {
    const n = sum(gif);
    add("D", `${config.label} contiene ${number(n)} ${n === 1 ? "registro clasificado" : "registros clasificados"} GIF (≥500 ha forestales) en ese periodo.`, config.gif);
  }
  const notes = [];
  if (from !== Number(state.from) || to !== Number(state.to)) notes.push(`Cobertura efectiva de estas cifras: ${from}–${to}; no cubre todo el periodo seleccionado.`);
  if (sourceFilters.length) notes.push("Lectura con los filtros activos de esta fuente.");
  if (source === "esfire30") notes.push("Cobertura geográfica parcial; una geometría puede relacionarse con varios territorios.");
  if (source === "effis") notes.push("Perímetros selectivos y provisionales; snapshot de 19/08/2026, no cierre anual.");
  if (source === "egif" && from < 1992) notes.push("La cobertura histórica EGIF es selectiva/transicional antes de 1992.");
  notes.push("Los registros y perímetros no equivalen a episodios únicos.");
  return { ...result, status: "ready", note: notes.join(" ") };
}

export function createTerritoryHistoryUi({ runtime, applyFilters, node = document.querySelector("#territory-history") }) {
  let generation = 0, current = null, lastKey = historyKey(runtime.getState());
  const blocked = {};
  const getters = { egif: "getEgifResult", icv: "getIcvResult", effis: "getEffisResult" };
  const get = source => runtime[getters[source]] ? runtime[getters[source]]() : null;
  const fresh = source => {
    const r = get(source);
    return r && r !== blocked[source] && runtime.getSourceLoadState()[source] === "ready" ? r : null;
  };
  function render(value, highlight = null) {
    current = value;
    node.dataset.status = value.status;
    node.dataset.source = value.source || "";
    node.querySelector(".territory-history__context").textContent = value.context || "Lectura del periodo seleccionado";
    node.querySelector(".territory-history__note").textContent = value.note || "";
    const list = node.querySelector("ul"); list.replaceChildren();
    for (const message of value.messages || []) {
      const li = document.createElement("li"); li.textContent = message.text; li.dataset.type = message.type; list.append(li);
      const item = message.type === "C" && highlight && highlight.items.find(row => (row.record_id || row.fire_id) === message.record_id);
      if (item) {
        const button = document.createElement("button"); button.type = "button"; button.className = "highlights-more";
        const action = highlightAction(runtime, message.source, item);
        button.textContent = action.label; li.append(button);
        const note = document.createElement("small"); note.textContent = action.note; li.append(note);
        const token = generation;
        bindHighlightSelection(button, { runtime, source: message.source, item, container: li, isCurrent: () => token === generation });
      }
    }
  }
  function invalidate() {
    const key = historyKey(runtime.getState());
    if (key === lastKey) return;
    lastKey = key;
    for (const source of Object.keys(getters)) blocked[source] = get(source);
    clear();
  }
  function clear(note = "Preparando la lectura del territorio…") {
    generation++;
    render({ status: "loading", messages: [], note });
  }
  async function update(territory, state, metricId) {
    invalidate();
    const token = ++generation, key = historyKey(state), source = sourceOf(metricId);
    if (key !== historyKey(runtime.getState()) || (territory.territory.territory_id !== (state.municipality_id || state.province_id || state.autonomous_community_id || "ES"))) return clear();
    const safeRuntime = { getEgifResult: () => fresh("egif"), getIcvResult: () => fresh("icv"), getEffisResult: () => fresh("effis") };
    const effective = applyFilters(territory, state, safeRuntime);
    const selected = effective.source_summaries.find(row => row.source_id === source);
    const exact = fresh(source);
    if (selected && selected.filtered_summary_mode === "EXACT_RUNTIME" && exact) {
      const annual = source === "egif" ? exact.summary.annual_metrics : exact.annual;
      const unknownField = source === "egif" ? "unknown_forest_area" : "unknown_area";
      const covered = Object.keys(annual || {}).filter(y => +y >= state.from && +y <= state.to);
      selected.history_gif_known = covered.length > 0 && covered.every(y => annual[y][unknownField] === 0);
    }
    const base = composeHistory({ territory: effective, state, metricId });
    render(base);
    if (base.status !== "ready" || !["egif", "icv"].includes(source) || !exact || exact.status !== "complete") return;
    try {
      const highlight = await runtime.getHighlights(source, 10);
      if (token !== generation || key !== historyKey(runtime.getState()) || exact !== fresh(source)) return;
      render(composeHistory({ territory: effective, state, metricId, highlight }), highlight);
    } catch (_) { /* Existing counts remain valid; a failed highlight is omitted. */ }
  }
  window.addEventListener("atlas:statechange", invalidate);
  return { update, clear, getState: () => current, destroy() { generation++; window.removeEventListener("atlas:statechange", invalidate); } };
}
