import { canonicalFilters, removeFilter, retainApplicableFilters, upsertFilter } from "./source_filters.mjs";

/** Estado y cobertura explícitos del prototipo nacional ES-4C.
 *
 * No serializa permalinks ni conoce datos: coordina fuentes con semánticas
 * distintas sin convertir ausencia de cobertura en cero registros.
 */

export const SOURCE_COVERAGE = {
  egif: { from: 1968, to: 2023, label: "EGIF · 1968–2023", entity_label: "partes administrativos" },
  esfire30: { from: 1985, to: 2021, label: "ESFire30 · 1985–2021", entity_label: "perímetros Landsat" },
  icv: { from: 1993, to: 2024, label: "ICV · 1993–2024", entity_label: "perímetros oficiales valencianos" },
  effis: { from: 2025, to: 2026, label: "EFFIS · 2025–2026", entity_label: "perímetros satelitales provisionales integrados" },
};

export function intersectCoverage(range, coverage) {
  const from = Math.max(range.from, coverage.from);
  const to = Math.min(range.to, coverage.to);
  return from <= to ? { from, to } : null;
}

export function normalizeRange(from, to) {
  const numericFrom = Number(from);
  const numericTo = Number(to);
  if (!Number.isInteger(numericFrom) || !Number.isInteger(numericTo)) throw new Error("Periodo inválido");
  return numericFrom <= numericTo ? { from: numericFrom, to: numericTo } : { from: numericTo, to: numericFrom };
}

export function effectiveCoverage(state, sourceId) {
  const coverage = SOURCE_COVERAGE[sourceId];
  if (!coverage) throw new Error(`Fuente desconocida: ${sourceId}`);
  return state[`${sourceId}_visible`] ? intersectCoverage(state, coverage) : null;
}

export function createRuntimeState(overrides = {}) {
  return {
    from: 1985,
    bearing: 0,
    pitch: 0,
    to: 2021,
    territory_scope: "ES",
    autonomous_community_id: null,
    province_id: null,
    municipality_id: null,
    esfire30_visible: true,
    egif_visible: true,
    icv_visible: false,
    effis_visible: false,
    selected_geometry_id: null,
    selected_geometry_year: null,
    selected_egif_record_id: null,
    selected_egif_year: null,
    selected_icv_geometry_id: null,
    selected_icv_geometry_year: null,
    selected_icv_record_id: null,
    selected_effis_geometry_id: null,
    selected_effis_geometry_year: null,
    filters: [],
    ...overrides,
    basemap: normalizeBasemap(overrides.basemap),
    filters: canonicalFilters(overrides.filters || []),
  };
}

export function normalizeBasemap(value) {
  return value === "relief" || value === "ortho" ? value : "map";
}

/** Devuelve el nivel territorial efectivo sin derivarlo de geometrías. */
export function selectedTerritoryId(state) {
  return state.municipality_id || state.province_id || state.autonomous_community_id || "ES";
}

function geometryStillVisible(state) {
  if (!state.selected_geometry_id) return true;
  if (!Number.isInteger(state.selected_geometry_year)) return true;
  const range = effectiveCoverage(state, "esfire30");
  return Boolean(range && state.selected_geometry_year >= range.from && state.selected_geometry_year <= range.to);
}

function recordStillVisible(state) {
  if (!state.selected_egif_record_id) return true;
  if (!Number.isInteger(state.selected_egif_year)) return true;
  const range = effectiveCoverage(state, "egif");
  return Boolean(range && state.selected_egif_year >= range.from && state.selected_egif_year <= range.to);
}

function icvSelectionStillVisible(state) {
  if (!state.selected_icv_geometry_id && !state.selected_icv_record_id) return true;
  const range = effectiveCoverage(state, "icv");
  if (!range || (state.autonomous_community_id && state.autonomous_community_id !== "ES:CCAA:10")) return false;
  if (!Number.isInteger(state.selected_icv_geometry_year)) return true;
  return state.selected_icv_geometry_year >= range.from && state.selected_icv_geometry_year <= range.to;
}

function effisGeometryStillVisible(state) {
  if (!state.selected_effis_geometry_id) return true;
  const range = effectiveCoverage(state, "effis");
  if (!range || state.autonomous_community_id !== "ES:CCAA:10") return false;
  if (!Number.isInteger(state.selected_effis_geometry_year)) return true;
  return state.selected_effis_geometry_year >= range.from && state.selected_effis_geometry_year <= range.to;
}

export function reduceRuntimeState(state, event) {
  // A background change cannot invalidate selections or scientific filters.
  if (event.type === "set_basemap") return { ...state, basemap: normalizeBasemap(event.basemap) };
  let next = { ...state };
  if (event.type === "set_range") Object.assign(next, normalizeRange(event.from, event.to));
  else if (event.type === "set_scope") {
    next.territory_scope = event.territory_id === "ES" ? "ES" : "autonomous_community";
    next.autonomous_community_id = event.territory_id === "ES" ? null : event.territory_id;
    next.province_id = null;
    next.municipality_id = null;
  } else if (event.type === "set_province") {
    if (typeof event.province_id !== "string" || typeof event.autonomous_community_id !== "string") {
      throw new Error("Una provincia requiere su CCAA canónica");
    }
    next.territory_scope = "province";
    next.autonomous_community_id = event.autonomous_community_id;
    next.province_id = event.province_id;
    next.municipality_id = null;
  } else if (event.type === "set_municipality") {
    if (typeof event.municipality_id !== "string" || typeof event.autonomous_community_id !== "string"
      || (event.province_id != null && typeof event.province_id !== "string")) throw new Error("Un municipio requiere padres canónicos");
    next.territory_scope = "municipality";
    next.autonomous_community_id = event.autonomous_community_id;
    next.province_id = event.province_id || null;
    next.municipality_id = event.municipality_id;
  } else if (event.type === "set_visibility") next[`${event.source_id}_visible`] = Boolean(event.visible);
  else if (event.type === "select_geometry") Object.assign(next, { selected_geometry_id: event.geometry_id, selected_geometry_year: event.year });
  else if (event.type === "select_egif_record") Object.assign(next, { selected_egif_record_id: event.record_id, selected_egif_year: event.year });
  else if (event.type === "select_icv_geometry") Object.assign(next, { selected_icv_geometry_id: event.geometry_id, selected_icv_geometry_year: event.year, selected_icv_record_id: event.record_id || null });
  else if (event.type === "select_icv_record") Object.assign(next, { selected_icv_record_id: event.record_id });
  else if (event.type === "select_effis_geometry") Object.assign(next, { selected_effis_geometry_id: event.geometry_id, selected_effis_geometry_year: event.year });
  else if (event.type === "clear_egif_selection") Object.assign(next, { selected_egif_record_id: null, selected_egif_year: null });
  else if (event.type === "clear_icv_geometry_selection") Object.assign(next, { selected_icv_geometry_id: null, selected_icv_geometry_year: null, selected_icv_record_id: null });
  else if (event.type === "clear_effis_geometry_selection") Object.assign(next, { selected_effis_geometry_id: null, selected_effis_geometry_year: null });
  else if (event.type === "clear_geometry_selection") Object.assign(next, { selected_geometry_id: null, selected_geometry_year: null });
  else if (event.type === "set_filter") next.filters = upsertFilter(next.filters, event.filter);
  else if (event.type === "remove_filter") next.filters = removeFilter(next.filters, event.filter_id);
  else if (event.type === "clear_filters") next.filters = [];
  else throw new Error(`Evento de estado desconocido: ${event.type}`);

  next.filters = retainApplicableFilters(next);

  if (!geometryStillVisible(next)) Object.assign(next, { selected_geometry_id: null, selected_geometry_year: null });
  if (!recordStillVisible(next)) Object.assign(next, { selected_egif_record_id: null, selected_egif_year: null });
  if (!icvSelectionStillVisible(next)) Object.assign(next, { selected_icv_geometry_id: null, selected_icv_geometry_year: null, selected_icv_record_id: null });
  if (!effisGeometryStillVisible(next)) Object.assign(next, { selected_effis_geometry_id: null, selected_effis_geometry_year: null });
  // Un parte seleccionado es administrativo: cualquier cambio territorial
  // invalida inmediatamente la ficha, antes de que el loader columnar termine
  // de comprobar el nuevo ámbito. La selección ESFire30 se valida por su
  // filtro espacial en el runtime, no por una relación con EGIF.
  if ((event.type === "set_scope" && state.autonomous_community_id !== next.autonomous_community_id)
    || (event.type === "set_province" && state.province_id !== next.province_id)
    || (event.type === "set_municipality" && state.municipality_id !== next.municipality_id)) {
    Object.assign(next, { selected_egif_record_id: null, selected_egif_year: null, selected_icv_geometry_id: null, selected_icv_geometry_year: null, selected_icv_record_id: null, selected_effis_geometry_id: null, selected_effis_geometry_year: null });
  }
  return next;
}
