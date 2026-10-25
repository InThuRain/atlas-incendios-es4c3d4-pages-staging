import { FILTER_CONTRACTS, canonicalFilters, retainApplicableFilters } from "./source_filters.mjs";
import { createRuntimeState, normalizeBasemap } from "./runtime_state.mjs";

/** The sole public view contract. Defaults are fixed for COMPACT_V1. */
export const STATE_VERSION = "COMPACT_V1";
export const VIEW_DEFAULTS = createRuntimeState({center: [-3.7, 40.3], zoom: 4, bearing: 0, pitch: 0, icv_visible: true});
const SOURCES = [["l", "esfire30", true], ["e", "egif", true], ["i", "icv", true], ["f", "effis", false]];
const FILTER_KEYS = {egif_min_area:"ea", egif_gif:"eg", icv_min_area:"ia", icv_gif:"ig", icv_cause:"ic", effis_min_area:"fa"};
const SELECTIONS = [
  ["g", "selected_geometry_id", /^esfire30:[\w:-]{1,120}$/],
  ["e", "selected_egif_record_id", /^egif-record:\d+$/],
  ["i", "selected_icv_geometry_id", /^gva:geometry:[\w:-]{1,120}$/],
  ["r", "selected_icv_record_id", /^gva:pif-cv:[\w:-]{1,120}$/],
  ["f", "selected_effis_geometry_id", /^effis:rda:[\w:-]{1,120}$/],
];
function number(value, min, max, fallback, digits = null) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return digits === null ? n : Number(n.toFixed(digits));
}
function years(from, to) {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1968 && to <= 2026 && from <= to;
}
function selection(value, expression) {
  return typeof value === "string" && expression.test(value) ? value : null;
}
function encode(value) {
  return encodeURIComponent(String(value)).replace(/%3A/g, ":").replace(/%2C/g, ",");
}

export function serializeState(state) {
  const entries = [["es", "1"]];
  const add = (key, value, fallback) => { if (value !== fallback) entries.push([key, value]); };
  const territory = state.municipality_id || state.province_id || state.autonomous_community_id || "ES";
  add("t", /^(?:ES|ES:CCAA:\d{2}|ES:PROV:\d{2}|ES:MUN:\d{5})$/.test(territory) ? territory : "ES", "ES");
  if (years(state.from, state.to)) add("y", state.from === state.to ? String(state.from) : state.from + "-" + state.to, "1985-2021");
  const center = Array.isArray(state.center) ? state.center : [];
  const lat = number(center[1], -90, 90, 40.3, 5), lon = number(center[0], -180, 180, -3.7, 5);
  add("c", lat + "," + lon, "40.3,-3.7");
  add("z", number(state.zoom, 3, 14, 4, 2), 4);
  add("a", number(state.bearing, -180, 180, 0, 1), 0);
  add("p", number(state.pitch, 0, 60, 0, 1), 0);
  add("b", {map:"", relief:"r", ortho:"o"}[normalizeBasemap(state.basemap)], "");
  add("s", SOURCES.filter(([,id,def]) => typeof state[id+"_visible"] === "boolean" && state[id+"_visible"] !== def)
    .map(([code,id]) => code + (state[id+"_visible"] ? "1" : "0")).join(","), "");
  const filters = retainApplicableFilters(state);
  for (const contract of FILTER_CONTRACTS) {
    const filter = filters.find(f => f.filter_id === contract.filter_id);
    if (filter) entries.push([FILTER_KEYS[filter.filter_id], filter.value === true ? "1" : String(filter.value)]);
  }
  for (const [key, field, expression] of SELECTIONS) {
    if (key === "r" && selection(state.selected_icv_geometry_id, SELECTIONS[2][2])) continue;
    const value = selection(state[field], expression);
    if (value) entries.push([key, value]);
  }
  return "#" + entries.map(([key,value]) => key + "=" + encode(value)).join("&");
}

export function parseStateHash(hash, defaults, territoryIds, provinceParents = new Map(), municipalityParents = null) {
  const state = createRuntimeState({...defaults, ...VIEW_DEFAULTS, center: [...VIEW_DEFAULTS.center]});
  if (!hash || hash === "#") return {status:"absent", state};
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  // Duplicated known keys fall back independently; unknown keys are ignored.
  const one = key => params.getAll(key).length === 1 ? params.get(key) : null;
  if (one("es") !== "1") return {status:"invalid", state};
  const territory = one("t");
  if (/^ES:CCAA:\d{2}$/.test(territory) && territoryIds.has(territory)) {
    state.territory_scope = "autonomous_community"; state.autonomous_community_id = territory;
  } else if (/^ES:PROV:\d{2}$/.test(territory) && provinceParents.has(territory)) {
    state.territory_scope = "province"; state.province_id = territory; state.autonomous_community_id = provinceParents.get(territory);
  } else if (/^ES:MUN:\d{5}$/.test(territory)) {
    const province = "ES:PROV:" + territory.slice(7,9);
    const row = municipalityParents && municipalityParents.get(territory);
    if (provinceParents.has(province) && (!municipalityParents || row)) {
      state.territory_scope = "municipality"; state.municipality_id = territory;
      state.province_id = row ? row.province_id : province;
      state.autonomous_community_id = row ? row.autonomous_community_id : provinceParents.get(province);
    }
  }
  const range = /^(\d{4})(?:-(\d{4}))?$/.exec(one("y") || "");
  if (range && years(Number(range[1]), Number(range[2] || range[1]))) {
    state.from = Number(range[1]); state.to = Number(range[2] || range[1]);
  }
  const coords = (one("c") || "").split(",");
  if (coords.length === 2) {
    const lat = number(coords[0], -90, 90, null, 5), lon = number(coords[1], -180, 180, null, 5);
    if (lat !== null && lon !== null) state.center = [lon, lat];
  }
  state.zoom = number(one("z"), 3, 14, 4, 2);
  state.bearing = number(one("a"), -180, 180, 0, 1);
  state.pitch = number(one("p"), 0, 60, 0, 1);
  state.basemap = one("b") === "r" ? "relief" : one("b") === "o" ? "ortho" : "map";
  const switches = (one("s") || "").split(",");
  for (const [code,id] of SOURCES) {
    const values = switches.filter(s => s.startsWith(code));
    if (values.length === 1 && new RegExp("^"+code+"[01]$").test(values[0])) state[id+"_visible"] = values[0][1] === "1";
  }
  state.filters = canonicalFilters(FILTER_CONTRACTS.map(contract => {
    const value = one(FILTER_KEYS[contract.filter_id]);
    return {...contract, value: contract.filter_type === "flag" ? value === "1" : contract.filter_type === "min_value" ? number(value,0,1000000,null) : value};
  }));
  state.filters = retainApplicableFilters(state);
  for (const [key,field,expression] of SELECTIONS) state[field] = selection(one(key), expression);
  if (state.selected_icv_geometry_id) state.selected_icv_record_id = null;
  return {status:"complete", state};
}
