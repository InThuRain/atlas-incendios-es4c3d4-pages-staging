const runtimeConfig = globalThis.__ATLAS_NATIONAL_RUNTIME_CONFIG__ || {};
function runtimeUrl(path) {
  return new URL(String(path), new URL(".", globalThis.location.href)).toString();
}
const protocolModuleUrl = runtimeConfig.pmtiles_protocol_module || "../vendor/pmtiles-4.3.0.mjs";
const { Protocol } = await import(protocolModuleUrl);
import { EGIFInitialLoader } from "./egif_initial_loader.mjs";
import { EGIFDetailLoader, locateRecord, pageOfInitialRows, recordMatchesInitialScope, rowMatchesInitialScope, topInitialRows } from "./egif_detail_loader.mjs";
import { EgifHighlightsLoader } from "./egif_highlights_loader.mjs";
import { canonicalTerritoryName, TERRITORY_OPTIONS } from "./territory_catalog.mjs";
import { PROVINCES_BY_COMMUNITY, PROVINCE_OPTIONS } from "./province_catalog.mjs";
import { createRuntimeState, effectiveCoverage, reduceRuntimeState, selectedTerritoryId, SOURCE_COVERAGE } from "./runtime_state.mjs";
import { parseStateHash, serializeState } from "./state_serialization.mjs";
import { addOfficialTerritoryLayer, CCAA_FILL_LAYER } from "./territory_layer.mjs";
import { addOfficialProvinceLayer, PROVINCE_FILL_LAYER } from "./province_layer.mjs";
import { routeMapClick } from "./map_click_routing.mjs";
import { MunicipalityLoader } from "./municipality_loader.mjs";
import { addOfficialMunicipalityLayer, MUNICIPALITY_FILL_LAYER } from "./municipality_layer.mjs";
import { MunicipalityEsfireIndexLoader, municipalityFilterExpression } from "./municipality_esfire_index.mjs";
import { IcvLoader, icvLevelForZoom } from "./icv_loader.mjs";
import { explorationIcvProvinces, containsLocation, municipalityAtLocation, MUNICIPAL_CLICK_ZOOM, PROVINCE_CLICK_ZOOM } from "./map_exploration.mjs";
import { EffisLoader, effisIntegratedTerritory } from "./effis_loader.mjs";
import { applicableFilterContracts, canonicalFilters, documentedIcvGif, filtersForSource } from "./source_filters.mjs";
import { temporalColorExpression, temporalVisualState } from "./temporal_style.mjs";
import { chooserLabel, dedupeAndSortHits, popupModel } from "./direct_popup.mjs";
import { mappedAreaFor } from "./esfire30_mapped_area.mjs";
import { adaptLegacyGvaV1State, dispatchStateHash, parseLegacyGvaV1State } from "./compat_gva_v1.mjs";

const runtimeAssets = runtimeConfig.assets || {};
const ARCHIVE_PATH = runtimeAssets.esfire30?.pmtiles?.path || "https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev/esfire30.pmtiles";
const SOURCE_ID = "esfire30";
const BASEMAP_SOURCE_ID = runtimeAssets.basemap?.source_id || "protomaps-context";
const BASEMAP_ARCHIVE_URL = runtimeAssets.basemap?.pmtiles?.path ? runtimeUrl(runtimeAssets.basemap.pmtiles.path) : null;
const BASEMAP_GLYPHS_TEMPLATE = runtimeAssets.basemap?.glyphs?.template || null;
const SOURCE_LAYER = "esfire30";
const FILL_LAYER = "esfire30-perimeters";
const OUTLINE_LAYER = "esfire30-perimeter-outlines";
const SELECTED_LAYER = "esfire30-selected";
const HOVER_LAYER = "esfire30-hover";
const YEAR_MIN = 1968;
// ICV se activa únicamente desde src/national/asset-config.mjs. El
// prototipo histórico conserva por tanto su tope 2023.
const ICV_MANIFEST_URL = runtimeAssets.icv?.manifest?.path ? runtimeUrl(runtimeAssets.icv.manifest.path) : null;
const ICV_ASSET_BASE_URL = runtimeUrl(runtimeAssets.icv?.asset_base_url?.path || runtimeConfig.asset_base_url || "./");
const ICV_ENABLED = Boolean(ICV_MANIFEST_URL);
const ICV_SOURCE_ID = "icv";
const ICV_FILL_LAYER = "icv-perimeters";
const ICV_OUTLINE_LAYER = "icv-perimeter-outlines";
const ICV_SELECTED_LAYER = "icv-selected";
const ICV_HOVER_LAYER = "icv-hover";
const EFFIS_MANIFEST_URL = runtimeAssets.effis?.manifest?.path ? runtimeUrl(runtimeAssets.effis.manifest.path) : null;
const EFFIS_ASSET_BASE_URL = runtimeUrl(runtimeAssets.effis?.asset_base_url?.path || runtimeConfig.asset_base_url || "./");
const EFFIS_ENABLED = Boolean(EFFIS_MANIFEST_URL);
const EFFIS_SOURCE_ID = "effis";
const EFFIS_FILL_LAYER = "effis-perimeters";
const EFFIS_OUTLINE_LAYER = "effis-perimeter-outlines";
const EFFIS_SELECTED_LAYER = "effis-selected";
const EFFIS_HOVER_LAYER = "effis-hover";
const YEAR_MAX = EFFIS_ENABLED ? 2026 : ICV_ENABLED ? 2024 : 2023;
const ESFIRE_YEAR_MIN = 1985;
const ESFIRE_YEAR_MAX = 2021;
const ESFIRE30_TERRITORY_OUT_OF_COVERAGE = new Set([
  "ES:CCAA:04", "ES:CCAA:05", "ES:CCAA:18", "ES:CCAA:19",
  "ES:PROV:07", "ES:PROV:35", "ES:PROV:38",
]);
const EGIF_MANIFEST_URL = runtimeUrl(runtimeAssets.egif?.manifest?.path || "data/egif/v1/2026-08-27/manifest.json");
const EGIF_HIGHLIGHTS_MANIFEST_URL = runtimeAssets.highlights?.manifest?.path
  ? runtimeUrl(runtimeAssets.highlights.manifest.path) : null;
const DEFAULT_VIEW = { center: [-3.7, 40.3], zoom: 4 };
const VIEWS = {
  spain: DEFAULT_VIEW,
  galicia: { center: [-8.1, 42.6], zoom: 6 },
  pais_valencia: { center: [-0.7, 39.3], zoom: 8 },
};

const output = document.querySelector("#debug-output, #runtime-test-output");
const selectionSummary = document.querySelector("#selection-summary");
const fromInput = document.querySelector("#from-year");
const toInput = document.querySelector("#to-year");
const applyButton = document.querySelector("#apply-years");
const territoryScope = document.querySelector("#territory-scope");
const provinceScope = document.querySelector("#province-scope");
const provinceScopeContainer = document.querySelector("#province-scope-container");
const municipalityScope = document.querySelector("#municipality-scope");
const municipalityScopeContainer = document.querySelector("#municipality-scope-container");
const territoryBreadcrumb = document.querySelector("#territory-breadcrumb");
const territorySemantics = document.querySelector("#territory-semantics");
const egifStatus = document.querySelector("#egif-status");
const egifMetrics = document.querySelector("#egif-metrics");
const egifRecordBrowser = document.querySelector("#egif-record-browser");
const egifRecordRows = document.querySelector("#egif-record-rows");
const egifRecordLookup = document.querySelector("#egif-record-lookup");
const egifRecordIdInput = document.querySelector("#egif-record-id");
const egifPagePrevious = document.querySelector("#egif-page-previous");
const egifPageNext = document.querySelector("#egif-page-next");
const egifPageStatus = document.querySelector("#egif-page-status");
const egifDetail = document.querySelector("#egif-detail");
const egifDetailStatus = document.querySelector("#egif-detail-status");
const egifDetailFields = document.querySelector("#egif-detail-fields");
const esfireVisibleInput = document.querySelector("#esfire30-visible");
const egifVisibleInput = document.querySelector("#egif-visible");
const icvVisibleInput = document.querySelector("#icv-visible");
const icvDetail = document.querySelector("#icv-detail");
const icvSelectionSummary = document.querySelector("#icv-selection-summary");
const icvDetailFields = document.querySelector("#icv-detail-fields");
const effisVisibleInput = document.querySelector("#effis-visible");
const effisDetail = document.querySelector("#effis-detail");
const effisSelectionSummary = document.querySelector("#effis-selection-summary");
const effisDetailFields = document.querySelector("#effis-detail-fields");
const sourceCoverage = document.querySelector("#source-coverage");
const runtimeStateSummary = document.querySelector("#runtime-state-summary");
const productShell = document.querySelector("#national-product-shell");
const copyStateLink = document.querySelector("#copy-state-link");
const copyStateStatus = document.querySelector("#copy-state-status");
const territoryStatus = document.querySelector("#territory-status");
const params = new URLSearchParams(location.search);
// Override efímero de diagnóstico ES-4C3D. Sólo admite HTTPS y no se guarda
// en el estado ni modifica la URL/base del asset local del prototipo.
const remotePmtilesUrl = params.get("pmtiles_url");
const archiveUrl = /^https:\/\//.test(remotePmtilesUrl || "")
  ? remotePmtilesUrl
  : runtimeUrl(ARCHIVE_PATH);
// Instrumentación efímera C3D3. Envuelve fetch sólo cuando el harness la
// solicita; no participa en el runtime normal ni altera las respuestas que
// consume PMTiles. Permite contabilizar los Range reales del navegador incluso
// si Resource Timing no expone tamaños cross-origin.
const remotePmtilesTelemetryEnabled = params.get("pmtiles_telemetry") === "1";
const remotePmtilesRequests = [];
function responseBytes(headers) {
  const range = headers.get("Content-Range");
  const match = range?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (match) return Number(match[2]) - Number(match[1]) + 1;
  const length = Number(headers.get("Content-Length"));
  return Number.isFinite(length) ? length : null;
}
function requestRange(input, init) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return headers.get("Range");
}
if (remotePmtilesTelemetryEnabled) {
  const baseFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input?.url;
    const tracked = requestUrl === archiveUrl;
    const started = performance.now();
    try {
      const response = await baseFetch(input, init);
      if (tracked) {
        const bytes = responseBytes(response.headers);
        remotePmtilesRequests.push({
          method: init?.method || (input instanceof Request ? input.method : "GET"),
          range: requestRange(input, init), status: response.status,
          content_range: response.headers.get("Content-Range"),
          content_length: response.headers.get("Content-Length"),
          response_bytes: bytes, elapsed_ms: performance.now() - started,
        });
      }
      return response;
    } catch (error) {
      if (tracked) {
        const aborted = error?.name === "AbortError";
        remotePmtilesRequests.push({ method: init?.method || "GET", range: requestRange(input, init), status: null, content_range: null, content_length: null, response_bytes: null, elapsed_ms: performance.now() - started, aborted, error: aborted ? null : String(error) });
      }
      throw error;
    }
  };
}
const browserRangeFetch = params.get("browser_range_fetch") === "1"
  ? window.fetch(archiveUrl, { headers: { Range: "bytes=0-0" }, cache: "no-store" }).then(async (response) => {
    const body = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, content_range: response.headers.get("Content-Range"), content_length: response.headers.get("Content-Length"), bytes: body.length, first_byte: body[0] ?? null };
  }).catch((error) => ({ error: String(error) }))
  : Promise.resolve(null);
const startedAt = performance.now();
const initialHeap = performance.memory?.usedJSHeapSize ?? null;
const errors = [];
const mapErrorEvents = [];
let state = createRuntimeState({
  center: [...DEFAULT_VIEW.center],
  zoom: DEFAULT_VIEW.zoom,
  icv_visible: ICV_ENABLED,
  effis_visible: EFFIS_ENABLED,
});
const PROTOTYPE_DEFAULT_STATE = { ...state, center: [...state.center] };
const egifLoader = new EGIFInitialLoader({ manifestUrl: EGIF_MANIFEST_URL });
const egifDetailLoader = new EGIFDetailLoader({ manifestUrl: EGIF_MANIFEST_URL });
const egifHighlightsLoader = EGIF_HIGHLIGHTS_MANIFEST_URL
  ? new EgifHighlightsLoader({ manifestUrl: EGIF_HIGHLIGHTS_MANIFEST_URL }) : null;
const municipalityLoader = new MunicipalityLoader({
  catalogUrl: runtimeAssets.municipalities?.catalog?.path,
  shardsRoot: runtimeAssets.municipalities?.shards_root?.path,
});
const municipalityEsfireIndexLoader = new MunicipalityEsfireIndexLoader({
  manifestUrl: runtimeAssets.esfire30_municipality_indexes?.manifest?.path,
  root: runtimeAssets.esfire30_municipality_indexes?.root?.path,
});
const icvLoader = ICV_ENABLED ? new IcvLoader({ manifestUrl: ICV_MANIFEST_URL, assetBaseUrl: ICV_ASSET_BASE_URL }) : null;
let latestIcvResult = { status: ICV_ENABLED ? "idle" : "not_configured", metrics: { records: 0, geometries: 0, assets: 0 } };
let icvLoadedLevel = null;
let icvViewKey = null;
let explorationClickController = null;

function cancelExplorationClick() {
  explorationClickController?.abort();
  explorationClickController = null;
}
const effisLoader = EFFIS_ENABLED ? new EffisLoader({ manifestUrl: EFFIS_MANIFEST_URL, assetBaseUrl: EFFIS_ASSET_BASE_URL }) : null;
let latestEffisResult = { status: EFFIS_ENABLED ? "idle" : "not_configured", metrics: { geometries: 0, assets: 0 } };
// Sólo es un conmutador de laboratorio C2B3B1. La navegación normal usa el
// shard del padre administrativo; los smokes comparan también el nacional.
const MUNICIPAL_INDEX_STRATEGY = ["national", "parent"].includes(params.get("municipal_index_strategy"))
  ? params.get("municipal_index_strategy") : "parent";
let egifReady = Promise.resolve();
let latestEgifResult = null;
let activeInitialAssets = [];
let egifPage = 0;
const EGIF_PAGE_SIZE = 50;
const territoryIds = new Set(TERRITORY_OPTIONS.map((territory) => territory.territory_id));
const provinceParents = new Map(PROVINCE_OPTIONS.map((province) => [province.territory_id, province.parent_id]));
let stateHydrated = false;
let restoringFromUrl = false;
let territoryLayer = null;
let territoryLayerError = null;
let provinceLayer = null;
let provinceLayerError = null;
let municipalityLayer = null;
let municipalityLayerError = null;
let municipalityCatalog = null;
let municipalityReady = Promise.resolve();
let latestMunicipalityResult = null;
let municipalityTransitionGeneration = 0;
let municipalLoadState = { generation: 0, municipality_id: null, phase: "idle" };
function publishMunicipalLoad(generation, phase, values = {}) {
  if (generation !== municipalityTransitionGeneration) return;
  municipalLoadState = { ...municipalLoadState, generation, phase, ...values };
  window.dispatchEvent(new CustomEvent("atlas:municipal-load", { detail: { ...municipalLoadState } }));
}
function cancelMunicipalTransition() {
  ++municipalityTransitionGeneration;
  municipalityLoader.cancel();
  publishMunicipalLoad(municipalityTransitionGeneration, "idle", { municipality_id: null, name: null });
}
let esfireTerritory = { status: "national", code: null, property_prefix: null, geometry_ids: null, geometry_id_set: null, strategy: null, metrics: null, expression_bytes: 0, filter_ms: 0, error: null };
let selectedGeometryProperties = null;
let directPopup = null;
let directPopupMeta = null;
let lastEsfireFilterStartedAt = null;
let filterNotice = "";
// Un error de transporte del PMTiles no equivale a falta de cobertura ni a
// cero relaciones. Sólo un reintento explícito por interacción puede despejarlo.
let esfireTransportError = null;
let esfireRecoveryRequested = false;
// Estado de interfaz derivado, no serializado: las fuentes no comparten
// errores, cachés ni ciclos de carga.
const sourceLoadState = { egif: "idle", esfire30: "idle", municipality: "idle", icv: ICV_ENABLED ? "idle" : "disabled", effis: EFFIS_ENABLED ? "idle" : "disabled" };
const sourceLoadGeneration = { egif: 0, esfire30: 0, municipality: 0, icv: 0, effis: 0 };

function beginSourceLoad(sourceId) {
  sourceLoadGeneration[sourceId] += 1;
  sourceLoadState[sourceId] = "loading";
  renderRuntimeState();
  return sourceLoadGeneration[sourceId];
}

function finishSourceLoad(sourceId, generation, status) {
  if (sourceLoadGeneration[sourceId] !== generation) return;
  sourceLoadState[sourceId] = status;
  renderRuntimeState();
  if (municipalLoadState.phase !== "idle") window.dispatchEvent(new CustomEvent("atlas:municipal-load", { detail: { ...municipalLoadState } }));
}

for (const territory of TERRITORY_OPTIONS) {
  const option = document.createElement("option");
  option.value = territory.territory_id;
  option.textContent = territory.label;
  territoryScope.append(option);
}
state = reduceRuntimeState(state, { type: "set_range", from: clampYear(params.get("from"), ESFIRE_YEAR_MIN), to: clampYear(params.get("to"), ESFIRE_YEAR_MAX) });
fromInput.value = String(state.from);
toInput.value = String(state.to);
const requestedTerritory = params.get("egif_scope");
if (requestedTerritory && [...territoryScope.options].some((option) => option.value === requestedTerritory)) {
  territoryScope.value = requestedTerritory;
  state = reduceRuntimeState(state, { type: "set_scope", territory_id: requestedTerritory });
}
const incomingHashFormat = dispatchStateHash(location.hash);
const parsedLegacyHash = incomingHashFormat === "gva_v1" ? parseLegacyGvaV1State(location.hash) : null;
const restoredHash = incomingHashFormat === "national_v1"
  ? parseStateHash(location.hash, PROTOTYPE_DEFAULT_STATE, territoryIds, provinceParents)
  : parsedLegacyHash?.status === "complete"
  ? adaptLegacyGvaV1State(parsedLegacyHash.state, PROTOTYPE_DEFAULT_STATE, { territoryIds, provinceParents })
  : { status: incomingHashFormat === "absent" ? "absent" : "invalid", state: { ...PROTOTYPE_DEFAULT_STATE } };
// Un #v=1 se conserva tal cual durante su restauración. La primera
// interacción que modifica el estado crea una entrada nacional v1; Copy Link
// siempre produce v1 pero no reescribe por sí solo el hash de entrada.
let legacyHashActive = incomingHashFormat === "gva_v1" && parsedLegacyHash?.status === "complete";
let legacyRestoreMapMovePending = false;
if (restoredHash.status !== "absent" && restoredHash.status !== "invalid") state = restoredHash.state;
fromInput.value = String(state.from);
toInput.value = String(state.to);
territoryScope.value = state.autonomous_community_id || "ES";
esfireVisibleInput.checked = state.esfire30_visible;
egifVisibleInput.checked = state.egif_visible;
if (icvVisibleInput) icvVisibleInput.checked = state.icv_visible;
if (effisVisibleInput) effisVisibleInput.checked = state.effis_visible;

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  container: "map",
  center: state.center,
  zoom: state.zoom,
  minZoom: 3,
  maxZoom: 14,
  attributionControl: false,
  style: {
    version: 8,
    ...(BASEMAP_GLYPHS_TEMPLATE ? { glyphs: BASEMAP_GLYPHS_TEMPLATE } : {}),
    sources: {
      [SOURCE_ID]: {
        type: "vector",
        url: `pmtiles://${archiveUrl}`,
      },
      [ICV_SOURCE_ID]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      [EFFIS_SOURCE_ID]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      {
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        layout: { "fill-sort-key": ["to-number", ["get", "year"]] },
        paint: { "fill-color": temporalColorExpression(temporalVisualState(state.from, state.to).domain), "fill-opacity": 0.2 },
      },
      {
        id: OUTLINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        paint: { "line-color": "#875b20", "line-width": 2, "line-opacity": 0.78, "line-dasharray": [2, 5] },
      },
      {
        id: ICV_FILL_LAYER,
        type: "fill",
        source: ICV_SOURCE_ID,
        layout: { "fill-sort-key": ["to-number", ["get", "year"]] },
        paint: { "fill-color": temporalColorExpression(temporalVisualState(state.from, state.to).domain), "fill-opacity": 0.28 },
      },
      {
        id: ICV_OUTLINE_LAYER,
        type: "line",
        source: ICV_SOURCE_ID,
        paint: { "line-color": temporalColorExpression(temporalVisualState(state.from, state.to).domain), "line-width": 1.2, "line-opacity": 0.9 },
      },
      {
        id: ICV_SELECTED_LAYER,
        type: "line",
        source: ICV_SOURCE_ID,
        filter: ["==", ["get", "geometry_id"], "__none__"],
        paint: { "line-color": "#151a18", "line-width": 3, "line-opacity": 1 },
      },
      {
        id: ICV_HOVER_LAYER,
        type: "line",
        source: ICV_SOURCE_ID,
        filter: ["==", ["get", "geometry_id"], "__none__"],
        paint: { "line-color": "#151a18", "line-width": 2.2, "line-opacity": 0.95 },
      },
      {
        id: EFFIS_FILL_LAYER,
        type: "fill",
        source: EFFIS_SOURCE_ID,
        layout: { "fill-sort-key": ["to-number", ["get", "year"]] },
        paint: { "fill-color": temporalColorExpression(temporalVisualState(state.from, state.to).domain), "fill-opacity": 0.2 },
      },
      {
        id: EFFIS_OUTLINE_LAYER,
        type: "line",
        source: EFFIS_SOURCE_ID,
        paint: { "line-color": temporalColorExpression(temporalVisualState(state.from, state.to).domain), "line-width": 2, "line-opacity": 0.85, "line-dasharray": [7, 5] },
      },
      {
        id: EFFIS_SELECTED_LAYER,
        type: "line",
        source: EFFIS_SOURCE_ID,
        filter: ["==", ["get", "geometry_id"], "__none__"],
        paint: { "line-color": "#211a2f", "line-width": 4, "line-dasharray": [2, 2] },
      },
      {
        id: EFFIS_HOVER_LAYER,
        type: "line",
        source: EFFIS_SOURCE_ID,
        filter: ["==", ["get", "geometry_id"], "__none__"],
        paint: { "line-color": "#211a2f", "line-width": 2.6, "line-opacity": 0.95, "line-dasharray": [2, 2] },
      },
      {
        id: SELECTED_LAYER,
        type: "line",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        filter: ["==", ["get", "geometry_id"], "__none__"],
        paint: { "line-color": "#151a18", "line-width": 4, "line-opacity": 1 },
      },
      {
        id: HOVER_LAYER,
        type: "line",
        source: SOURCE_ID,
        "source-layer": SOURCE_LAYER,
        filter: ["==", ["get", "geometry_id"], "__none__"],
        paint: { "line-color": "#151a18", "line-width": 2.8, "line-opacity": 0.95, "line-dasharray": [2, 5] },
      },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");

const territoryLayerReady = new Promise((resolve) => {
  map.once("load", () => {
    addOfficialTerritoryLayer(map, {
      onSelect: (territoryId) => {
        // Cuando ya estamos dentro de esa CCAA, el clic inferior de la capa
        // CCAA no debe borrar la selección de provincia de la capa superior.
        if (state.autonomous_community_id !== territoryId) setEgifScope(territoryId);
      },
    }).then((layer) => {
      territoryLayer = layer;
      syncTerritoryLayer();
      territoryStatus.textContent = "Límite oficial BDLJE cargado. El ámbito controla EGIF y filtra ESFire30 por intersección territorial.";
      resolve(layer);
    }).catch((error) => {
      territoryLayerError = String(error);
      territoryStatus.textContent = `Límite oficial no disponible: ${error.message}. EGIF y ESFire30 continúan independientemente.`;
      resolve(null);
    });
  });
});

const provinceLayerReady = territoryLayerReady.then(async () => {
  try {
    const layer = await addOfficialProvinceLayer(map, {
      onSelect: (provinceId, parentId) => {
        // La feature ya trae el parent_id BDLJE cruzado con ES-2; no se
        // deduce territorio a partir de incendios ni de su viewport.
        if (state.autonomous_community_id === parentId) setProvinceScope(provinceId, parentId);
      },
    });
    provinceLayer = layer;
    syncTerritoryLayer();
    return layer;
  } catch (error) {
    provinceLayerError = String(error);
    territoryStatus.textContent = `${territoryStatus.textContent} Límite provincial no disponible: ${error.message}.`;
    return null;
  }
});

const municipalityLayerReady = provinceLayerReady.then(async () => {
  try {
    municipalityLayer = addOfficialMunicipalityLayer(map, {
      onSelect: (municipalityId) => setMunicipalityScope(municipalityId),
    });
    return municipalityLayer;
  } catch (error) {
    municipalityLayerError = String(error);
    territoryStatus.textContent = `${territoryStatus.textContent} Límite municipal no disponible: ${error.message}.`;
    return null;
  }
});

async function ensureMunicipalityCatalog() {
  if (!municipalityCatalog) municipalityCatalog = await municipalityLoader.loadCatalog();
  return municipalityCatalog;
}

function municipalParentId() {
  return state.province_id || (state.autonomous_community_id && !PROVINCES_BY_COMMUNITY.has(state.autonomous_community_id) ? state.autonomous_community_id : null);
}

async function refreshMunicipalGeometry({ fit = false, restore = false, expectedMunicipalityId = null } = {}) {
  const generation = beginSourceLoad("municipality");
  if (!state.province_id && !(state.autonomous_community_id && !PROVINCES_BY_COMMUNITY.has(state.autonomous_community_id))) {
    municipalityLoader.cancel(); municipalityLayer?.clear(); municipalityScopeContainer.hidden = true; latestMunicipalityResult = { status: "not_required" }; finishSourceLoad("municipality", generation, "idle"); return latestMunicipalityResult;
  }
  try {
    const loaded = await municipalityLoader.loadForParent({ provinceId: state.province_id, autonomousCommunityId: state.autonomous_community_id });
    if (loaded.status === "stale" || generation !== sourceLoadGeneration.municipality) return { status: "stale" };
    if (expectedMunicipalityId && !loaded.shard?.data?.features?.some((feature) => feature.properties?.municipality_id === expectedMunicipalityId)) {
      throw new Error(`El shard municipal no contiene ${expectedMunicipalityId}`);
    }
    municipalityCatalog = loaded.catalog;
    renderMunicipalitySelector();
    municipalityLayer?.setCollection(loaded.shard?.data || null);
    municipalityLayer?.setSelected(state.municipality_id);
    if (fit && state.municipality_id && !restore) municipalityLayer?.fit(municipalityCatalog.byId.get(state.municipality_id)?.bounds);
    latestMunicipalityResult = loaded; finishSourceLoad("municipality", generation, "ready"); return loaded;
  } catch (error) {
    if (generation !== sourceLoadGeneration.municipality) return { status: "stale" };
    municipalityLayer?.clear(); municipalityScopeContainer.hidden = true;
    territoryStatus.textContent = `Municipios BDLJE no disponibles: ${error.message}. Las fuentes restantes continúan independientes.`;
    latestMunicipalityResult = { status: "error", error: String(error) }; finishSourceLoad("municipality", generation, "error"); return latestMunicipalityResult;
  }
}

function clampYear(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= YEAR_MIN && parsed <= YEAR_MAX ? parsed : fallback;
}

function yearFilter() {
  const range = effectiveCoverage(state, "esfire30");
  // Tippecanoe conserva `year` como atributo de tesela; la conversión hace
  // explícita la comparación numérica sin depender de su serialización MVT.
  if (!range) return ["==", ["get", "year"], "__outside_esfire30_coverage__"];
  const { from, to } = range;
  return ["all", [">=", ["to-number", ["get", "year"]], from], ["<=", ["to-number", ["get", "year"]], to]];
}

// La escala se deriva sólo del intervalo solicitado y de la cobertura geométrica
// conocida 1985–2026. No mira los resultados de filtros por área/GIF/causa ni
// el subconjunto de teselas cargado, para que un mismo año conserve su sentido.
function currentTemporalVisual() {
  return temporalVisualState(state.from, state.to);
}

function applyTemporalStyle() {
  const visual = currentTemporalVisual();
  const color = visual.expression;
  for (const layer of [FILL_LAYER, ICV_FILL_LAYER, EFFIS_FILL_LAYER]) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, "fill-color", color);
  }
  for (const layer of [ICV_OUTLINE_LAYER, EFFIS_OUTLINE_LAYER]) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, "line-color", color);
  }
  return visual;
}

function setLayerFilter(layer, filter) {
  if (map.getLayer(layer)) map.setFilter(layer, filter);
}

function clearHover(sourceId) {
  const layer = sourceId === "icv" ? ICV_HOVER_LAYER : sourceId === "effis" ? EFFIS_HOVER_LAYER : HOVER_LAYER;
  setLayerFilter(layer, ["==", ["get", "geometry_id"], "__none__"]);
}

function showHover(sourceId, feature) {
  const geometryId = feature?.properties?.geometry_id;
  if (!geometryId) return clearHover(sourceId);
  const layer = sourceId === "icv" ? ICV_HOVER_LAYER : sourceId === "effis" ? EFFIS_HOVER_LAYER : HOVER_LAYER;
  setLayerFilter(layer, ["==", ["get", "geometry_id"], String(geometryId)]);
}

function territoryCode(territoryId) {
  const match = /^ES:(CCAA|PROV):(\d{2})$/.exec(territoryId || "");
  return match ? { code: Number(match[2]), property_prefix: match[1] === "CCAA" ? "ccaa" : "prov" } : null;
}

function territoryFilterExpression() {
  if (esfireTerritory.status === "national") return ["!=", ["get", "geometry_id"], "__outside_selected_territory__"];
  if (esfireTerritory.status === "municipality") return municipalityFilterExpression(esfireTerritory.geometry_ids);
  if (esfireTerritory.status !== "covered") return ["==", ["get", "geometry_id"], "__outside_selected_territory__"];
  return ["any", ...[1, 2, 3].map((slot) => ["==", ["get", `${esfireTerritory.property_prefix}_${slot}`], esfireTerritory.code])];
}

function featureMatchesTerritory(properties) {
  if (esfireTerritory.status === "national") return true;
  if (esfireTerritory.status === "municipality") return esfireTerritory.geometry_id_set?.has(String(properties?.geometry_id)) || false;
  if (esfireTerritory.status !== "covered") return false;
  return [1, 2, 3].some((slot) => Number(properties?.[`${esfireTerritory.property_prefix}_${slot}`]) === esfireTerritory.code);
}

function applyFilters() {
  lastEsfireFilterStartedAt = performance.now();
  const territoryFilter = territoryFilterExpression();
  const visibleFilter = ["all", yearFilter(), territoryFilter];
  applyTemporalStyle();
  setLayerFilter(FILL_LAYER, visibleFilter);
  setLayerFilter(OUTLINE_LAYER, visibleFilter);
  setLayerFilter(HOVER_LAYER, ["==", ["get", "geometry_id"], "__none__"]);
  setLayerFilter(SELECTED_LAYER, state.selected_geometry_id
    ? ["all", visibleFilter, ["==", ["get", "geometry_id"], state.selected_geometry_id]]
    : ["==", ["get", "geometry_id"], "__none__"]);
}

async function refreshEsfireTerritoryFilter() {
  const generation = beginSourceLoad("esfire30");
  const municipalityId = state.municipality_id;
  const territoryId = municipalityId ? (state.province_id || state.autonomous_community_id || "ES") : (state.province_id || state.autonomous_community_id || "ES");
  if (!state.esfire30_visible || !effectiveCoverage(state, "esfire30")) {
    municipalityEsfireIndexLoader.cancel();
    esfireTerritory = { status: "inactive", code: null, property_prefix: null, geometry_ids: null, geometry_id_set: null, strategy: null, metrics: null, expression_bytes: 0, filter_ms: 0, error: null };
    applyFilters(); finishSourceLoad("esfire30", generation, "idle"); return esfireTerritory;
  }
  if (esfireTransportError && !esfireRecoveryRequested) {
    esfireTerritory = { status: "error", code: null, property_prefix: null, geometry_ids: null, geometry_id_set: null, strategy: null, metrics: null, expression_bytes: 0, filter_ms: 0, error: esfireTransportError };
    applyFilters(); finishSourceLoad("esfire30", generation, "error"); return esfireTerritory;
  }
  esfireTransportError = null;
  esfireRecoveryRequested = false;
  if (municipalityId) {
    if (ESFIRE30_TERRITORY_OUT_OF_COVERAGE.has(territoryId)) {
      municipalityEsfireIndexLoader.cancel();
      esfireTerritory = { status: "no_coverage", code: null, property_prefix: null, geometry_ids: null, geometry_id_set: null, strategy: MUNICIPAL_INDEX_STRATEGY, metrics: null, expression_bytes: 0, filter_ms: 0, error: null };
      applyFilters(); finishSourceLoad("esfire30", generation, "ready"); return esfireTerritory;
    }
    const started = performance.now();
    try {
      const resolved = await municipalityEsfireIndexLoader.resolve({ municipalityId, parentId: territoryId, strategy: MUNICIPAL_INDEX_STRATEGY });
      if (resolved.status === "stale" || state.municipality_id !== municipalityId) return resolved;
      const geometryIds = resolved.geometry_ids;
      const expression = municipalityFilterExpression(geometryIds);
      esfireTerritory = {
        status: "municipality", code: null, property_prefix: null, geometry_ids: geometryIds, geometry_id_set: new Set(geometryIds),
        strategy: resolved.strategy, metrics: resolved.metrics, expression_bytes: new TextEncoder().encode(JSON.stringify(expression)).byteLength,
        filter_ms: 0, error: null,
      };
      const filterStarted = performance.now(); applyFilters(); esfireTerritory.filter_ms = performance.now() - filterStarted;
      esfireTerritory.prepare_ms = performance.now() - started;
      // Al cambiar de municipio el identificador seleccionado no implica una
      // relación administrativa: sólo puede permanecer si figura en la lista
      // de intersección positiva del municipio actual.
      if (state.selected_geometry_id && !esfireTerritory.geometry_id_set.has(state.selected_geometry_id)) clearGeometrySelection();
      finishSourceLoad("esfire30", generation, "ready"); return esfireTerritory;
    } catch (error) {
      esfireTerritory = { status: "error", code: null, property_prefix: null, geometry_ids: null, geometry_id_set: null, strategy: MUNICIPAL_INDEX_STRATEGY, metrics: null, expression_bytes: 0, filter_ms: 0, error: String(error) };
      applyFilters(); finishSourceLoad("esfire30", generation, "error"); return esfireTerritory;
    }
  }
  municipalityEsfireIndexLoader.cancel();
  if (territoryId === "ES") {
    esfireTerritory = { status: "national", code: null, property_prefix: null, geometry_ids: null, geometry_id_set: null, strategy: null, metrics: null, expression_bytes: 0, filter_ms: 0, error: null };
    applyFilters(); finishSourceLoad("esfire30", generation, "ready"); return esfireTerritory;
  }
  const encoded = territoryCode(territoryId);
  const started = performance.now();
  esfireTerritory = encoded
    ? { status: ESFIRE30_TERRITORY_OUT_OF_COVERAGE.has(territoryId) ? "no_coverage" : "covered", ...encoded, geometry_ids: null, geometry_id_set: null, strategy: null, metrics: null, expression_bytes: 0, filter_ms: 0, error: null }
    : { status: "no_coverage", code: null, property_prefix: null, geometry_ids: null, geometry_id_set: null, strategy: null, metrics: null, expression_bytes: 0, filter_ms: 0, error: "Código territorial no representable en tesela" };
  applyFilters();
  esfireTerritory.filter_ms = performance.now() - started;
  const current = selectedGeometryProperties || (state.selected_geometry_id ? findLoadedGeometry(state.selected_geometry_id)?.properties : null);
  if (state.selected_geometry_id && current && !featureMatchesTerritory(current)) clearGeometrySelection();
  finishSourceLoad("esfire30", generation, esfireTerritory.status === "error" ? "error" : "ready"); return esfireTerritory;
}

async function applyYears() {
  const from = clampYear(fromInput.value, YEAR_MIN);
  const to = clampYear(toInput.value, YEAR_MAX);
  transition({ type: "set_range", from, to });
  if (sourceLoadState.esfire30 === "error") esfireRecoveryRequested = true;
  fromInput.value = String(state.from);
  toInput.value = String(state.to);
  applyFilters();
  await refreshSources();
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits }).format(value);
}

function formatOptionalArea(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${formatNumber(value, 2)} ha` : "No disponible";
}

function popupTerritoryName() {
  if (state.municipality_id) return municipalityCatalog?.byId.get(state.municipality_id)?.official_name || "el municipio seleccionado";
  if (state.province_id) return PROVINCE_OPTIONS.find((row) => row.territory_id === state.province_id)?.official_name || "la provincia seleccionada";
  return territoryScope.selectedOptions[0]?.textContent || "España";
}

function setMapPopupActive(active) {
  if (productShell) productShell.dataset.mapPopupActive = String(Boolean(active));
}

function closeDirectPopup() {
  const popup = directPopup;
  directPopup = null;
  directPopupMeta = null;
  setMapPopupActive(false);
  popup?.remove();
}

function closeDirectPopupFor(sourceId) {
  if (!directPopupMeta) return;
  const includesSource = directPopupMeta.hits.some((hit) => hit.sourceId === sourceId);
  if (includesSource) closeDirectPopup();
}

function popupSourceForLayer(layerId) {
  if ([ICV_FILL_LAYER, ICV_OUTLINE_LAYER, ICV_SELECTED_LAYER, ICV_HOVER_LAYER].includes(layerId)) return "icv";
  if ([EFFIS_FILL_LAYER, EFFIS_OUTLINE_LAYER, EFFIS_SELECTED_LAYER, EFFIS_HOVER_LAYER].includes(layerId)) return "effis";
  if ([FILL_LAYER, OUTLINE_LAYER, SELECTED_LAYER, HOVER_LAYER].includes(layerId)) return "esfire30";
  return null;
}

function popupRecordFor(hit) {
  return hit.sourceId === "icv" ? latestIcvResult.fires_by_id?.get(hit.feature.properties?.fire_id) || null : null;
}

function popupModelFor(hit) {
  return popupModel({
    sourceId: hit.sourceId,
    properties: hit.feature.properties || {},
    record: popupRecordFor(hit),
    territoryName: popupTerritoryName(),
  });
}

function directPopupState() {
  return directPopupMeta ? {
    active: true,
    kind: directPopupMeta.kind,
    hit_count: directPopupMeta.hits.length,
    source_id: directPopupMeta.hit?.sourceId || null,
    geometry_id: directPopupMeta.hit?.geometryId || null,
    anchor: directPopupMeta.anchor ? { ...directPopupMeta.anchor } : null,
  } : { active: false, kind: null, hit_count: 0, source_id: null, geometry_id: null, anchor: null };
}

function appendPopupRows(target, rows) {
  const list = document.createElement("dl");
  list.className = "direct-popup__fields";
  for (const [label, value] of rows) {
    const term = document.createElement("dt"); term.textContent = label;
    const definition = document.createElement("dd"); definition.textContent = String(value);
    list.append(term, definition);
  }
  target.append(list);
}

function popupHeader(title, sourceLabel) {
  const header = document.createElement("header"); header.className = "direct-popup__header";
  const titleNode = document.createElement("h3"); titleNode.textContent = title;
  const source = document.createElement("span"); source.className = "direct-popup__source"; source.textContent = sourceLabel;
  const close = document.createElement("button"); close.type = "button"; close.className = "direct-popup__close";
  close.setAttribute("aria-label", "Cerrar información del perímetro"); close.textContent = "Cerrar";
  close.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); closeDirectPopup(); });
  const text = document.createElement("div"); text.append(titleNode, source);
  header.append(text, close);
  return header;
}

function selectPopupHit(hit, { showDetail = false } = {}) {
  if (hit.sourceId === "icv") return selectIcvFeature(hit.feature, { showDetail });
  if (hit.sourceId === "effis") return selectEffisFeature(hit.feature, { showDetail });
  return selectFeature(hit.feature);
}

function revealPopupDetails(hit) {
  closeDirectPopup();
  selectPopupHit(hit, { showDetail: true });
  const card = document.querySelector(`[data-detail-card="${hit.sourceId}"]`);
  if (card) {
    card.classList.remove("is-minimized");
    card.querySelector("[data-detail-minimize]")?.setAttribute("aria-expanded", "true");
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function openDirectFeaturePopup(hit, lngLat) {
  closeDirectPopup();
  if (hit.sourceId === "esfire30") {
    hit.model = popupModel({ sourceId: hit.sourceId, properties: { ...hit.feature.properties, mapped_area_status: "loading" }, territoryName: popupTerritoryName() });
  }
  hit.model ||= popupModelFor(hit);
  selectPopupHit(hit, { showDetail: false });
  const content = document.createElement("section"); content.className = "direct-popup";
  content.setAttribute("role", "dialog"); content.setAttribute("aria-label", `Información de ${hit.model.title}`);
  content.append(popupHeader(hit.model.title, hit.model.sourceLabel));
  appendPopupRows(content, hit.model.rows);
  if (hit.model.note) { const note = document.createElement("p"); note.className = "direct-popup__note"; note.textContent = hit.model.note; content.append(note); }
  const details = document.createElement("button"); details.type = "button"; details.className = "direct-popup__details"; details.textContent = "Ver detalles";
  details.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); revealPopupDetails(hit); });
  content.append(details);
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, closeOnMove: false, focusAfterOpen: false, maxWidth: "22rem", offset: 10 })
    .setLngLat(lngLat).setDOMContent(content).addTo(map);
  directPopup = popup;
  directPopupMeta = { kind: "feature", hit, hits: [hit], anchor: { lng: lngLat.lng, lat: lngLat.lat } };
  if (hit.sourceId === "esfire30") {
    mappedAreaFor(hit.geometryId).then((value) => {
      // A late response cannot reopen a closed popup or update a different hit.
      if (directPopup !== popup || directPopupMeta?.hit !== hit) return;
      hit.model = popupModel({ sourceId: hit.sourceId, properties: { ...hit.feature.properties,
        mapped_area_ha: value, mapped_area_status: value === null ? "unavailable" : "ready" }, territoryName: popupTerritoryName() });
      const holder = document.createElement("div");
      appendPopupRows(holder, hit.model.rows);
      content.querySelector(".direct-popup__fields").replaceWith(holder.firstElementChild);
      popup.setLngLat(popup.getLngLat());
    });
  }
  setMapPopupActive(true);
  popup.on("close", () => { if (directPopup === popup) { directPopup = null; directPopupMeta = null; setMapPopupActive(false); } });
}

function openDirectPopupChooser(hits, lngLat) {
  closeDirectPopup();
  const content = document.createElement("section"); content.className = "direct-popup direct-popup--chooser";
  content.setAttribute("role", "dialog"); content.setAttribute("aria-label", "Elegir perímetro");
  content.append(popupHeader(`${hits.length} perímetros en este punto`, "Elige el que quieres consultar"));
  const list = document.createElement("ul"); list.className = "direct-popup__choices";
  for (const hit of hits) {
    hit.model ||= popupModelFor(hit);
    const item = document.createElement("li");
    const button = document.createElement("button"); button.type = "button";
    // Identidad sólo para la interacción y el harness: nunca se muestra como
    // texto humano ni se usa para asociar geometrías entre fuentes.
    button.dataset.popupGeometryId = hit.geometryId;
    button.dataset.popupSource = hit.sourceId;
    const label = document.createElement("strong"); label.textContent = chooserLabel(hit);
    const source = document.createElement("span"); source.textContent = hit.model.sourceLabel;
    button.append(label, source);
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openDirectFeaturePopup(hit, lngLat); });
    item.append(button); list.append(item);
  }
  content.append(list);
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, closeOnMove: false, focusAfterOpen: false, maxWidth: "22rem", offset: 10 })
    .setLngLat(lngLat).setDOMContent(content).addTo(map);
  directPopup = popup;
  directPopupMeta = { kind: "chooser", hit: null, hits, anchor: { lng: lngLat.lng, lat: lngLat.lat } };
  setMapPopupActive(true);
  popup.on("close", () => { if (directPopup === popup) { directPopup = null; directPopupMeta = null; setMapPopupActive(false); } });
}

function mapPopupHits(point) {
  const layers = [FILL_LAYER, OUTLINE_LAYER, SELECTED_LAYER, HOVER_LAYER,
    ICV_FILL_LAYER, ICV_OUTLINE_LAYER, ICV_SELECTED_LAYER, ICV_HOVER_LAYER,
    EFFIS_FILL_LAYER, EFFIS_OUTLINE_LAYER, EFFIS_SELECTED_LAYER, EFFIS_HOVER_LAYER]
    .filter((layerId) => map.getLayer(layerId) && map.getLayoutProperty(layerId, "visibility") !== "none"
      && state[`${popupSourceForLayer(layerId)}_visible`]);
  if (!layers.length) return [];
  const rendered = map.queryRenderedFeatures(point, { layers });
  return dedupeAndSortHits(rendered.map((feature, renderOrder) => ({ feature, renderOrder, sourceId: popupSourceForLayer(feature.layer?.id) })).filter((hit) => hit.sourceId));
}

function handleFirePopupHits(hits, event) {
  if (!hits.length) { closeDirectPopup(); return; }
  if (hits.length === 1) openDirectFeaturePopup(hits[0], event.lngLat);
  else openDirectPopupChooser(hits, event.lngLat);
}

function navigableTerritoryAtPoint(point) {
  const location = map.unproject(point).toArray();
  if (map.getZoom() >= MUNICIPAL_CLICK_ZOOM) return { location };
  if (map.getZoom() >= PROVINCE_CLICK_ZOOM && provinceLayer) {
    const matches = [...provinceLayer.byId.values()].filter(f => containsLocation(f.geometry, location));
    if (matches.length === 1) return { province: matches[0].properties };
  }
  // Most specific current administrative background wins; query once before
  // any mutation. Do not let a new scope change the routing of this gesture.
  for (const [layerId, controller] of [[MUNICIPALITY_FILL_LAYER, municipalityLayer],
    [PROVINCE_FILL_LAYER, provinceLayer], [CCAA_FILL_LAYER, territoryLayer]]) {
    if (!controller || !map.getLayer(layerId)) continue;
    const feature = map.queryRenderedFeatures(point, { layers: [layerId] })[0];
    if (feature) return { feature, controller };
  }
  return null;
}

function handleMapPopupClick(event) {
  cancelExplorationClick();
  return routeMapClick(event, {
    queryFireHits: mapPopupHits,
    handleFireHits: handleFirePopupHits,
    queryTerritory: navigableTerritoryAtPoint,
    handleTerritory: (target) => {
      closeDirectPopup();
      if (target.location) {
        const controller = new AbortController();
        explorationClickController = controller;
        territoryStatus.textContent = "Consultando el municipio en el límite oficial…";
        municipalityAtLocation(municipalityLoader, target.location, controller.signal).then(id => {
          if (controller.signal.aborted) return;
          explorationClickController = null;
          if (id) return setMunicipalityScope(id, { fit: false });
          territoryStatus.textContent = "No se ha identificado un municipio único en este punto. Se conserva la vista.";
        }).catch(error => {
          if (!controller.signal.aborted) territoryStatus.textContent = `Límite municipal no disponible: ${error.message}. Se conserva la vista.`;
        });
      } else if (target.province) {
        setProvinceScope(target.province.territory_id, target.province.parent_id, { fit: false });
      } else target.controller.selectFromFeature(target.feature);
    },
    handleEmpty: () => closeDirectPopup(),
  });
}

function formatGif(value) {
  if (value === true) return "Sí (administrativo EGIF)";
  if (value === false) return "No (administrativo EGIF)";
  return "No determinable";
}

function clearEgifSelection(updateState = true) {
  if (updateState) state = reduceRuntimeState(state, { type: "clear_egif_selection" });
  egifDetailLoader.clearSelection();
  egifDetail.hidden = true;
  egifDetailStatus.textContent = "Selecciona un registro para cargar su información ampliada.";
  egifDetailFields.replaceChildren();
}

function clearGeometrySelection(updateState = true) {
  closeDirectPopupFor("esfire30");
  if (updateState) state = reduceRuntimeState(state, { type: "clear_geometry_selection" });
  selectedGeometryProperties = null;
  applyFilters();
  selectionSummary.textContent = "Pulsa o toca un perímetro para inspeccionarlo.";
}

function transition(event) {
  cancelExplorationClick();
  // El ancla del popup es un punto del estado visible. Cualquier cambio de
  // periodo, territorio, fuente o filtro puede retirar esa geometría: se
  // cierra sin tocar la selección hasta que el reducer/loader la valide.
  if (["set_range", "set_scope", "set_province", "set_municipality", "set_visibility", "set_filter", "remove_filter", "clear_filters"].includes(event.type)) closeDirectPopup();
  const previous = state;
  state = reduceRuntimeState(state, event);
  const previousFilterIds = new Set((previous.filters || []).map((row) => row.filter_id));
  const nextFilterIds = new Set((state.filters || []).map((row) => row.filter_id));
  const removedContextually = [...previousFilterIds].filter((id) => !nextFilterIds.has(id));
  if (!["remove_filter", "clear_filters"].includes(event.type) && removedContextually.length) {
    filterNotice = removedContextually.length === 1
      ? "Se ha retirado un filtro porque ya no está disponible en este territorio, periodo o fuente."
      : "Se han retirado filtros que ya no están disponibles en este territorio, periodo o fuente.";
  } else if (["set_filter", "remove_filter", "clear_filters"].includes(event.type)) filterNotice = "";
  if (previous.selected_geometry_id && !state.selected_geometry_id) clearGeometrySelection(false);
  if (previous.selected_egif_record_id && !state.selected_egif_record_id) clearEgifSelection(false);
  if ((previous.selected_icv_geometry_id || previous.selected_icv_record_id) && !(state.selected_icv_geometry_id || state.selected_icv_record_id)) clearIcvSelection(false);
  if (previous.selected_effis_geometry_id && !state.selected_effis_geometry_id) clearEffisSelection(false);
  replaceStateUrl({ promoteLegacy: true });
  window.dispatchEvent(new CustomEvent("atlas:statechange", { detail: { type: event.type } }));
  return state;
}

async function setAnalysisFilter(filter) {
  transition({ type: "set_filter", filter });
  await refreshSources();
  return { status: "complete", filters: canonicalFilters(state.filters) };
}

async function removeAnalysisFilter(filterId) {
  transition({ type: "remove_filter", filter_id: filterId });
  await refreshSources();
  return { status: "complete", filters: canonicalFilters(state.filters) };
}

async function clearAnalysisFilters() {
  transition({ type: "clear_filters" });
  await refreshSources();
  return { status: "complete", filters: [] };
}

function clearSourceSelection(sourceId) {
  if (sourceId === "egif") clearEgifSelection();
  else if (sourceId === "esfire30") clearGeometrySelection();
  else if (sourceId === "icv") clearIcvSelection();
  else if (sourceId === "effis") clearEffisSelection();
  else return false;
  replaceStateUrl({ promoteLegacy: true });
  return true;
}

function renderProvinceSelector() {
  const communityId = state.autonomous_community_id;
  const provinces = communityId ? (PROVINCES_BY_COMMUNITY.get(communityId) || []) : [];
  provinceScope.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Toda la comunidad autónoma";
  provinceScope.append(all);
  for (const province of provinces) {
    const option = document.createElement("option");
    option.value = province.territory_id;
    option.textContent = province.official_name;
    provinceScope.append(option);
  }
  provinceScope.value = state.province_id || "";
  provinceScopeContainer.hidden = !communityId || provinces.length === 0;
}

function renderMunicipalitySelector() {
  const parentId = municipalParentId();
  const rows = !municipalityCatalog || !parentId ? []
    : (state.province_id ? municipalityCatalog.byProvince.get(parentId) : municipalityCatalog.byCity.get(parentId)) || [];
  municipalityScope.replaceChildren();
  const all = document.createElement("option"); all.value = ""; all.textContent = "Todos los municipios del ámbito"; municipalityScope.append(all);
  for (const row of rows) { const option = document.createElement("option"); option.value = row.municipality_id; option.textContent = row.official_name; municipalityScope.append(option); }
  municipalityScope.value = state.municipality_id || "";
  municipalityScopeContainer.hidden = rows.length === 0;
}

function renderBreadcrumb() {
  territoryBreadcrumb.replaceChildren();
  const entries = [{ label: "España", target: "ES", current: state.territory_scope === "ES" }];
  if (state.autonomous_community_id) entries.push({ label: territoryScope.selectedOptions[0]?.textContent || state.autonomous_community_id, target: state.autonomous_community_id, current: state.territory_scope === "autonomous_community" });
  if (state.province_id) entries.push({ label: PROVINCE_OPTIONS.find((row) => row.territory_id === state.province_id)?.official_name || state.province_id, target: state.province_id, current: state.territory_scope === "province" });
  if (state.municipality_id) entries.push({ label: municipalityCatalog?.byId.get(state.municipality_id)?.official_name || state.municipality_id, target: state.municipality_id, current: true });
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = entry.label; button.disabled = entry.current;
    button.dataset.territoryTarget = entry.target;
    territoryBreadcrumb.append(button);
  }
}

function syncTerritoryLayer({ fit = false } = {}) {
  if (territoryLayer) territoryLayer.setSelected(state.autonomous_community_id);
  if (provinceLayer) provinceLayer.setScope(state.autonomous_community_id, state.province_id);
  if (municipalityLayer) municipalityLayer.setSelected(state.municipality_id);
  renderProvinceSelector();
  renderMunicipalitySelector();
  renderBreadcrumb();
  if (!fit) return Boolean(territoryLayer || provinceLayer);
  if (state.municipality_id && municipalityLayer && municipalityCatalog) return municipalityLayer.fit(municipalityCatalog.byId.get(state.municipality_id)?.bounds);
  if (state.province_id && provinceLayer) return provinceLayer.fit(state.province_id);
  return territoryLayer ? territoryLayer.fit(state.autonomous_community_id || "ES") : false;
}

function sourceCoverageDescription(sourceId) {
  const source = SOURCE_COVERAGE[sourceId];
  const range = effectiveCoverage(state, sourceId);
  const visible = state[`${sourceId}_visible`];
  const loading = sourceLoadState[sourceId] === "loading" ? " · cargando" : sourceLoadState[sourceId] === "error" ? " · error aislado" : "";
  if (!visible) return `${source.label}: desactivada${loading}`;
  if (!range) return `${source.label}: sin cobertura para ${state.from}–${state.to}${loading}`;
  const partial = range.from !== state.from || range.to !== state.to;
  const basic = `${source.label}: ${partial ? `cobertura efectiva ${range.from}–${range.to}` : `cobertura ${range.from}–${range.to}`}`;
  if (sourceId === "esfire30" && esfireTerritory.status === "no_coverage") return `${basic} · sin cobertura ESFire30 para el territorio seleccionado${loading}`;
  if (sourceId === "esfire30" && esfireTerritory.status === "municipality" && esfireTerritory.geometry_ids?.length === 0) return `${basic} · sin perímetros ESFire30 que intersecten este municipio para la cobertura disponible${loading}`;
  if (sourceId === "esfire30" && esfireTerritory.status === "error") return `${basic} · ESFire30 no disponible por error de carga${loading}`;
  if (sourceId === "icv" && latestIcvResult.status === "error") return `${basic} · ICV no disponible por error de carga aislado${loading}`;
  if (sourceId === "icv" && !state.autonomous_community_id) return `${basic} · carga por vista al acercarse al País Valencià; el resumen sigue siendo España${loading}`;
  if (sourceId === "icv" && state.autonomous_community_id !== "ES:CCAA:10") return `${basic} · sin cobertura ICV fuera de País Valencià${loading}`;
  if (sourceId === "icv" && latestIcvResult.status === "complete") return `${basic} · ${formatNumber(latestIcvResult.metrics.records)} partes fuente y ${formatNumber(latestIcvResult.metrics.geometries)} perímetros cargados${loading}`;
  if (sourceId === "effis" && state.autonomous_community_id !== "ES:CCAA:10") return `${basic} · datos EFFIS no integrados para este territorio${loading}`;
  if (sourceId === "effis" && latestEffisResult.status === "error") return `${basic} · EFFIS no disponible por error de carga aislado${loading}`;
  if (sourceId === "effis" && latestEffisResult.status === "complete") return `${basic} · ${formatNumber(latestEffisResult.metrics.geometries)} perímetros satelitales provisionales cargados${loading}`;
  return `${basic}${loading}`;
}

function renderRuntimeState() {
  sourceCoverage.replaceChildren();
  for (const sourceId of ["esfire30", "egif", ...(ICV_ENABLED ? ["icv"] : []), ...(EFFIS_ENABLED ? ["effis"] : [])]) {
    const item = document.createElement("li");
    item.textContent = sourceCoverageDescription(sourceId);
    sourceCoverage.append(item);
  }
  const egifSummary = latestEgifResult?.summary;
  const territory = state.municipality_id
    ? (municipalityCatalog?.byId.get(state.municipality_id)?.official_name || state.municipality_id)
    : state.province_id
    ? (PROVINCE_OPTIONS.find((row) => row.territory_id === state.province_id)?.official_name || state.province_id)
    : (territoryScope.selectedOptions[0]?.textContent || "España");
  const esfireVisible = state.esfire30_visible && effectiveCoverage(state, "esfire30")
    ? map.queryRenderedFeatures({ layers: [FILL_LAYER] }).length : 0;
  const esfireScope = state.municipality_id
    ? esfireTerritory.status === "no_coverage" ? "sin cobertura ESFire30"
    : esfireTerritory.status === "municipality" && esfireTerritory.geometry_ids?.length === 0 ? "sin perímetros ESFire30 que intersecten el municipio"
    : esfireTerritory.status === "municipality" ? "perímetros que intersectan el territorio municipal actual"
    : "índice municipal ESFire30 cargando o no disponible"
    : esfireTerritory.status === "no_coverage" ? "sin cobertura ESFire30"
    : esfireTerritory.status === "error" ? "error de carga ESFire30"
    : "perímetros que intersectan el territorio seleccionado";
  const icvSummary = ICV_ENABLED ? ` · ICV: ${sourceLoadState.icv}, ${latestIcvResult.metrics?.assets ?? 0} shard(s), ${latestIcvResult.metrics?.records ?? 0} partes fuente, ${latestIcvResult.metrics?.geometries ?? 0} perímetros` : "";
  const effisSummary = EFFIS_ENABLED ? ` · EFFIS: ${sourceLoadState.effis}, ${latestEffisResult.metrics?.assets ?? 0} asset(s), ${latestEffisResult.metrics?.geometries ?? 0} perímetros provisionales` : "";
  runtimeStateSummary.textContent = `Periodo solicitado: ${state.from}–${state.to} · ámbito: ${territory} · fuentes: ESFire30 ${sourceLoadState.esfire30}, EGIF ${sourceLoadState.egif}, municipios ${sourceLoadState.municipality} · EGIF INITIAL: ${activeInitialAssets.length} asset(s), ${egifSummary?.summary?.records ?? egifSummary?.records ?? 0} partes · ESFire30: ${esfireScope} · visibles en viewport: ${formatNumber(esfireVisible)}${icvSummary}${effisSummary}.`;
  territorySemantics.textContent = state.municipality_id
    ? "Límite municipal BDLJE actual (snapshot 2026). EGIF: partes enlazadas documentalmente al municipio canónico; no implica contención física histórica. ESFire30 1985–2021: perímetros que intersectan este límite municipal actual; no son municipio EGIF, municipio histórico, origen ni punto de ignición."
    : "El ámbito resalta límites oficiales, filtra EGIF administrativamente y muestra perímetros ESFire30 que intersectan el territorio seleccionado. ICV aporta perímetros oficiales valencianos; EFFIS aporta perímetros satelitales provisionales del snapshot integrado. Son fuentes independientes.";
}

function coverageStatePayload() {
  const describe = (sourceId) => {
    const range = effectiveCoverage(state, sourceId);
    return {
      visible: state[`${sourceId}_visible`],
      declared_coverage: SOURCE_COVERAGE[sourceId],
      effective_coverage: range,
      status: !state[`${sourceId}_visible`] ? "disabled" : range ? "covered" : "no_coverage",
    };
  };
  const icv = describe("icv");
  icv.status = !state.icv_visible ? "disabled" : !icv.effective_coverage ? "no_coverage" : latestIcvResult.status;
  const effis = describe("effis");
  effis.status = !state.effis_visible ? "disabled" : !effis.effective_coverage ? "no_coverage" : !effisIntegratedTerritory(state) ? "not_integrated_for_territory" : latestEffisResult.status;
  return { requested_range: { from: state.from, to: state.to }, territory_id: selectedTerritoryId(state), source_load_state: { ...sourceLoadState }, esfire30: { ...describe("esfire30"), territory_filter_status: esfireTerritory.status, municipality_filter_pending: sourceLoadState.esfire30 === "loading" && Boolean(state.municipality_id), municipality_geometry_ids: esfireTerritory.geometry_ids?.length ?? null }, egif: describe("egif"), ...(ICV_ENABLED ? { icv } : {}), ...(EFFIS_ENABLED ? { effis } : {}) };
}

function stateUrl() {
  return `${location.origin}${location.pathname}${location.search}${serializeState(state)}`;
}

function replaceStateUrl({ promoteLegacy = false } = {}) {
  if (!stateHydrated || restoringFromUrl) return;
  if (legacyHashActive) {
    if (!promoteLegacy) return;
    legacyHashActive = false;
    history.pushState({ prototype: "es4c", version: 1, migrated_from: "gva-v1" }, "", `${location.pathname}${location.search}${serializeState(state)}`);
    return;
  }
  history.replaceState({ prototype: "es4c", version: 1 }, "", `${location.pathname}${location.search}${serializeState(state)}`);
}

async function copyCurrentStateLink() {
  const url = stateUrl();
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    else {
      const fallback = document.createElement("textarea");
      fallback.value = url;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    copyStateStatus.textContent = "Enlace copiado.";
    return { status: "copied", url };
  } catch (error) {
    copyStateStatus.textContent = "No se pudo copiar automáticamente; copia esta URL: " + url;
    return { status: "fallback", url, error: String(error) };
  }
}

function renderEgifPage() {
  egifRecordRows.replaceChildren();
  if (!activeInitialAssets.length) {
    egifRecordBrowser.hidden = true;
    return;
  }
  const pageData = pageOfInitialRows(activeInitialAssets, state.from, state.to, egifPage, EGIF_PAGE_SIZE, state.province_id, state.municipality_id, state.filters);
  const pages = Math.max(1, Math.ceil(pageData.total / EGIF_PAGE_SIZE));
  if (egifPage >= pages) {
    egifPage = pages - 1;
    return renderEgifPage();
  }
  for (const row of pageData.rows) {
    const tr = document.createElement("tr");
    const values = [String(row.year), "Ver ficha", formatOptionalArea(row.reported_forest_area_ha), row.is_gif_forest_ge_500_ha === true ? "Sí" : "No"];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = value;
        button.dataset.recordId = row.record_id;
        button.setAttribute("aria-label", `Ver ficha del registro administrativo de ${row.year}`);
        cell.append(button);
      } else cell.textContent = value;
      tr.append(cell);
    });
    egifRecordRows.append(tr);
  }
  egifPageStatus.textContent = `${formatNumber(pageData.total)} partes · página ${egifPage + 1}/${pages}`;
  egifPagePrevious.disabled = egifPage === 0;
  egifPageNext.disabled = egifPage + 1 >= pages;
  egifRecordBrowser.hidden = false;
}

function renderDetailFields(record, names) {
  egifDetailFields.replaceChildren();
  const municipality = record.municipality_id
    ? (names.municipality || record.municipality_id)
    : "Municipio no resuelto en la normalización";
  const rows = [
    ["Identificador técnico", record.record_id],
    ["ID fuente / Número de parte", record.source_record_id || "No disponible"],
    ["Fuente", "EGIF · parte administrativo"],
    ["Año", record.year],
    ["Fecha de inicio", record.detection_date || "No disponible"],
    ["Fecha de extinción", record.extinction_date || "No disponible"],
    ["CCAA", names.autonomous_community || record.autonomous_community_id || "No disponible"],
    ["Provincia", names.province || record.province_id || "No disponible"],
    ["Municipio", municipality],
    ["Municipio declarado en la fuente", record.source_municipality_name || "No disponible"],
    ["Paraje declarado", record.source_paraje || "No disponible"],
    ["Superficie forestal declarada", formatOptionalArea(record.reported_forest_area_ha)],
    ["Superficie total declarada", formatOptionalArea(record.reported_total_area_ha)],
    ["Superficie arbolada declarada", formatOptionalArea(record.reported_wooded_area_ha)],
    ["Superficie no arbolada declarada", formatOptionalArea(record.reported_nonwooded_area_ha)],
    ["GIF", formatGif(record.is_gif_forest_ge_500_ha)],
    ["Causa", record.cause_source_code == null ? "Código EGIF no disponible" : `Código EGIF ${record.cause_source_code} (sin normalizar)`],
    ["Causa canónica", record.canonical_cause || "No mapeada"],
    ["Estado del mapeo", record.cause_mapping_status || "unmapped"],
    ["Modelo de parte", record.form_model || "No disponible"],
    ["ID de base fuente", record.source_database_id || "No disponible"],
    ["Identidad del episodio", record.episode_identity_status || "unresolved"],
  ];
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value == null ? "No disponible" : String(value);
    egifDetailFields.append(term, definition);
  }
}

async function selectEgifRecordFromAssets(recordId, loadedAssets, { requireActiveScope = true } = {}) {
  const location = locateRecord(loadedAssets, recordId);
  const inScope = location && rowMatchesInitialScope(location.loaded.data.columns, location.ordinal, state.from, state.to, state.province_id, state.municipality_id, state.filters)
    && (!state.autonomous_community_id || location.loaded.data.columns.autonomous_community_id[location.ordinal] === state.autonomous_community_id);
  if (!inScope || (requireActiveScope && !recordMatchesInitialScope(activeInitialAssets, recordId, state.from, state.to, state.province_id, state.municipality_id, state.filters))) {
    egifDetail.hidden = false;
    egifDetailStatus.textContent = "El record_id no pertenece al ámbito EGIF cargado.";
    return { status: "missing" };
  }
  transition({ type: "select_egif_record", record_id: recordId, year: location.loaded.data.columns.year[location.ordinal] });
  egifDetail.hidden = false;
  egifDetailStatus.textContent = "Cargando la información ampliada del registro seleccionado…";
  egifDetailFields.replaceChildren();
  const heapBefore = performance.memory?.usedJSHeapSize ?? null;
  try {
    const result = await egifDetailLoader.select({ recordId, loadedAssets });
    if (result.status === "stale" || state.selected_egif_record_id !== recordId) return result;
    const [autonomous_community, province, municipality] = await Promise.all([
      canonicalTerritoryName(result.record.autonomous_community_id),
      canonicalTerritoryName(result.record.province_id),
      canonicalTerritoryName(result.record.municipality_id),
    ]);
    if (state.selected_egif_record_id !== recordId) return { status: "stale" };
    renderDetailFields(result.record, { autonomous_community, province, municipality });
    const heapAfter = performance.memory?.usedJSHeapSize ?? null;
    egifDetailStatus.textContent = `Información ampliada disponible${result.metrics.cached ? " desde la caché de esta sesión" : ""}.`;
    return { ...result, heap_delta_bytes: heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore };
  } catch (error) {
    if (error.name === "AbortError") return { status: "stale" };
    if (state.selected_egif_record_id === recordId) {
      egifDetailStatus.textContent = `No se pudo cargar la información ampliada: ${error.message}. El mapa y la lista continúan disponibles.`;
    }
    return { status: "error", error: String(error) };
  }
}

async function selectEgifRecord(recordId) {
  return selectEgifRecordFromAssets(recordId, activeInitialAssets);
}

async function selectEgifHighlight(itemOrId) {
  const recordId = typeof itemOrId === "string" ? itemOrId : itemOrId?.record_id;
  let candidate = typeof itemOrId === "object" ? itemOrId : null;
  if (!recordId) return { status: "missing" };
  const loadedLocation = locateRecord(activeInitialAssets, recordId);
  if (loadedLocation) return selectEgifRecord(recordId);
  if (!egifHighlightsLoader || state.autonomous_community_id) return { status: "missing" };
  candidate ||= await egifHighlightsLoader.find(recordId);
  if (!candidate?.asset_id || candidate.year < state.from || candidate.year > state.to) return { status: "missing" };
  const stateKey = `${state.from}|${state.to}|${JSON.stringify(state.filters || [])}|${state.autonomous_community_id || "ES"}`;
  const loaded = await egifLoader.loadAssetById(candidate.asset_id);
  if (stateKey !== `${state.from}|${state.to}|${JSON.stringify(state.filters || [])}|${state.autonomous_community_id || "ES"}`) return { status: "stale" };
  return selectEgifRecordFromAssets(recordId, [loaded], { requireActiveScope: false });
}

async function getEgifHighlights(limit = 10) {
  if (!state.egif_visible || !effectiveCoverage(state, "egif")) return { status: "inactive", source_id: "egif", items: [] };
  const sourceFilters = filtersForSource(state.filters, "egif");
  const items = state.autonomous_community_id
    ? topInitialRows(activeInitialAssets, state.from, state.to, limit, state.province_id, state.municipality_id, sourceFilters)
    : egifHighlightsLoader ? await egifHighlightsLoader.top({ fromYear: state.from, toYear: state.to, filters: sourceFilters, limit }) : [];
  return {
    status: state.autonomous_community_id || egifHighlightsLoader ? "complete" : "not_configured",
    source_id: "egif", entity_type: "administrative_source_record",
    metric_id: "egif_declared_forest_area_ha", ordering: "reported_forest_area_ha_desc_record_id_asc", unit: "ha",
    null_policy: "excluded_not_zero", items,
    delivery: state.autonomous_community_id ? "loaded_initial_columns" : "small_annual_national_derivative",
    telemetry: state.autonomous_community_id ? { additional_requests: 0, additional_bytes: 0 } : { ...egifHighlightsLoader?.telemetry },
  };
}

function getIcvHighlights(limit = 10) {
  const ids = latestIcvResult.active_fire_ids || new Set();
  const items = [...ids].map((id) => latestIcvResult.fires_by_id?.get(id)).filter((fire) => typeof fire?.reported_forest_area_ha === "number" && Number.isFinite(fire.reported_forest_area_ha))
    .sort((left, right) => right.reported_forest_area_ha - left.reported_forest_area_ha || left.fire_id.localeCompare(right.fire_id)).slice(0, Math.min(10, limit));
  return { status: latestIcvResult.status, source_id: "icv", entity_type: "official_fire_source_record", metric_id: "icv_declared_forest_area_ha", ordering: "reported_forest_area_ha_desc_fire_id_asc", unit: "ha", null_policy: "excluded_not_zero", items, telemetry: { additional_requests: 0, additional_bytes: 0 } };
}

function getEffisHighlights(limit = 10) {
  const items = (latestEffisResult.features || []).filter((feature) => typeof feature.properties?.mapped_area_ha === "number" && Number.isFinite(feature.properties.mapped_area_ha))
    .sort((left, right) => right.properties.mapped_area_ha - left.properties.mapped_area_ha || String(left.properties.geometry_id).localeCompare(String(right.properties.geometry_id))).slice(0, Math.min(10, limit));
  return { status: latestEffisResult.status, source_id: "effis", entity_type: "provisional_satellite_perimeter", metric_id: "effis_mapped_area_ha", ordering: "mapped_area_ha_desc_geometry_id_asc", unit: "ha", null_policy: "excluded_not_zero", snapshot: "2026-08-19", provisional: true, items, telemetry: { additional_requests: 0, additional_bytes: 0 } };
}

async function getHighlights(sourceId, limit = 10) {
  if (sourceId === "egif") return getEgifHighlights(limit);
  if (sourceId === "icv") return getIcvHighlights(limit);
  if (sourceId === "effis") return getEffisHighlights(limit);
  return { status: "deferred_no_safe_ranking_metric", source_id: "esfire30", metric_id: null, ordering: null, unit: null, items: [] };
}

async function selectHighlight(sourceId, item) {
  if (sourceId === "egif") return selectEgifHighlight(item);
  if (sourceId === "icv") return selectIcvRecord(item?.fire_id);
  if (sourceId === "effis") return selectEffisFeature(item);
  return null;
}

function renderEgifResult(result) {
  if (result.status === "stale") return;
  latestEgifResult = { ...result };
  delete latestEgifResult.loaded_assets;
  egifMetrics.hidden = true;
  egifMetrics.replaceChildren();
  const summary = result.summary;
  if (result.kind === "manifest_summary") {
    activeInitialAssets = [];
    egifRecordBrowser.hidden = true;
    egifStatus.textContent = `${formatNumber(summary.records)} partes EGIF disponibles en ${state.from}–${state.to}; España usa solo el manifest y no carga INITIAL.`;
    const rows = [["Bloques implicados", summary.blocks.map(([from, to]) => `${from}–${to}`).join(", ")], ["Assets INITIAL no cargados", "0"]];
    for (const [label, value] of rows) { const term = document.createElement("dt"); term.textContent = label; const definition = document.createElement("dd"); definition.textContent = value; egifMetrics.append(term, definition); }
    egifMetrics.hidden = false;
    renderRuntimeState();
    return;
  }
  activeInitialAssets = result.loaded_assets || [];
  egifPage = 0;
  egifStatus.textContent = `${formatNumber(summary.records)} partes EGIF cargados en ${result.assets.length} asset(s) INITIAL. No hay geometrías EGIF ni enlaces con ESFire30.`;
  const rows = [
    ["GIF administrativos", formatNumber(summary.administrative_gif)],
    ["Superficie forestal declarada (valores conocidos)", `${formatNumber(summary.known_forest_area_sum, 2)} ha`],
    ["Partes con superficie forestal conocida", formatNumber(summary.records_with_known_forest_area)],
    ["Partes con superficie forestal desconocida", formatNumber(summary.records_with_unknown_forest_area)],
    ["Partes con municipio resuelto", formatNumber(summary.municipality_resolved)],
    ["Partes sin municipio resuelto", formatNumber(summary.municipality_unresolved)],
    ["Años con partes", formatNumber(Object.keys(summary.annual).length)],
    ["Distribución anual", Object.entries(summary.annual).map(([year, count]) => `${year}: ${formatNumber(count)}`).join(" · ")],
  ];
  for (const [label, value] of rows) { const term = document.createElement("dt"); term.textContent = label; const definition = document.createElement("dd"); definition.textContent = value; egifMetrics.append(term, definition); }
  egifMetrics.hidden = false;
  renderEgifPage();
  renderRuntimeState();
}

async function refreshEgif() {
  const generation = beginSourceLoad("egif");
  const coverage = effectiveCoverage(state, "egif");
  if (!state.egif_visible || !coverage) {
    egifLoader.cancel();
    activeInitialAssets = [];
    egifMetrics.hidden = true;
    egifRecordBrowser.hidden = true;
    clearEgifSelection(false);
    egifStatus.textContent = state.egif_visible
      ? `EGIF: sin cobertura para ${state.from}–${state.to}.`
      : "EGIF desactivado; no se cargan assets INITIAL.";
    latestEgifResult = { status: "inactive", kind: "no_coverage", summary: { records: 0, asset_count: 0 } };
    renderRuntimeState();
    finishSourceLoad("egif", generation, "idle"); return latestEgifResult;
  }
  activeInitialAssets = [];
  egifRecordBrowser.hidden = true;
  const territoryId = state.autonomous_community_id || "ES";
  egifStatus.textContent = territoryId === "ES" ? "Calculando resumen EGIF desde el manifest…" : "Cargando assets INITIAL EGIF…";
  try {
    const result = await egifLoader.loadScope({ territoryId, fromYear: coverage.from, toYear: coverage.to, provinceId: state.province_id, municipalityId: state.municipality_id, filters: filtersForSource(state.filters, "egif") });
    renderEgifResult(result);
    // España no tiene INITIAL activos por política. Una selección explícita
    // procedente del pequeño índice de destacados se valida/restaura después,
    // sin convertirla en carga nacional automática.
    if (state.autonomous_community_id && state.selected_egif_record_id && !recordMatchesInitialScope(activeInitialAssets, state.selected_egif_record_id, state.from, state.to, state.province_id, state.municipality_id, state.filters)) clearEgifSelection();
    if (result.status !== "stale") finishSourceLoad("egif", generation, "ready"); return result;
  } catch (error) {
    egifStatus.textContent = `EGIF no disponible: ${error.message}. ESFire30 continúa operativo.`;
    latestEgifResult = { status: "error", error: String(error) };
    renderRuntimeState();
    finishSourceLoad("egif", generation, "error"); return latestEgifResult;
  }
}

function setIcvCollection(features = []) {
  const source = map.getSource(ICV_SOURCE_ID);
  source?.setData({ type: "FeatureCollection", features });
}

function clearIcvSelection(updateState = true) {
  closeDirectPopupFor("icv");
  if (updateState) state = reduceRuntimeState(state, { type: "clear_icv_geometry_selection" });
  setLayerFilter(ICV_SELECTED_LAYER, ["==", ["get", "geometry_id"], "__none__"]);
  clearHover("icv");
  if (icvDetail) icvDetail.hidden = true;
  if (icvSelectionSummary) icvSelectionSummary.textContent = "Pulsa o toca un perímetro oficial valenciano para inspeccionarlo.";
  if (icvDetailFields) icvDetailFields.replaceChildren();
}

function renderIcvDetail(feature) {
  if (!icvDetail || !icvDetailFields || !icvSelectionSummary) return;
  const properties = feature.properties || {};
  const fire = latestIcvResult.fires_by_id?.get(properties.fire_id);
    const gif = documentedIcvGif(fire);
    const rows = [
    ["Fuente", "ICV / Generalitat Valenciana · perímetro oficial"],
    ["Identificador de geometría", properties.geometry_id],
    ["Identificador del registro", properties.fire_id],
    ["Número PIF CV", fire?.num_pif_cv || properties.source_record_id || "No disponible"],
    ["Año", fire?.year ?? properties.year],
    ["Fecha de inicio", fire?.start_date || "No disponible"],
    ["Fecha de extinción", fire?.end_date || "No disponible"],
    ["Provincia declarada", fire?.province || properties.province || "No disponible"],
    ["Municipio declarado", fire?.municipality_name || "No disponible"],
    ["Municipio administrativo ICV", properties.municipality_id || "No disponible"],
    ["Paraje", fire?.place_name || "No disponible"],
    ["Superficie forestal declarada", formatOptionalArea(fire?.reported_forest_area_ha)],
    ["Causa documentada", fire?.cause_label || "No disponible"],
    ["Código de causa", fire?.cause_code || "No disponible"],
    ["GIF", gif === true ? "Sí · criterio documentado ICV ≥500 ha" : gif === false ? "No · criterio documentado ICV ≥500 ha" : "No disponible"],
    ["Calidad geométrica", "A · vector oficial"],
    ["Geometrías de este source record", Array.isArray(fire?.geometry_ids) ? fire.geometry_ids.length : "No disponible"],
  ];
  icvDetailFields.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement("dt"); term.textContent = label;
    const definition = document.createElement("dd"); definition.textContent = value == null ? "No disponible" : String(value);
    icvDetailFields.append(term, definition);
  }
  icvDetail.hidden = false;
  icvSelectionSummary.textContent = `geometry_id: ${properties.geometry_id} · source record: ${properties.fire_id} · ICV / perímetro oficial Generalitat.`;
}

function selectIcvFeature(feature, { showDetail = true } = {}) {
  const geometryId = feature?.properties?.geometry_id;
  if (!geometryId) return null;
  transition({ type: "select_icv_geometry", geometry_id: String(geometryId), year: Number(feature.properties.year), record_id: String(feature.properties.fire_id || "") });
  setLayerFilter(ICV_SELECTED_LAYER, ["==", ["get", "geometry_id"], String(geometryId)]);
  if (showDetail) renderIcvDetail(feature);
  else if (icvDetail) icvDetail.hidden = true;
  return state.selected_icv_geometry_id;
}

function findLoadedIcvGeometry(geometryId) {
  return latestIcvResult.features?.find((feature) => String(feature.properties?.geometry_id) === geometryId) || null;
}

function selectIcvRecord(recordId) {
  const fire = latestIcvResult.fires_by_id?.get(recordId);
  if (!fire || (latestIcvResult.active_fire_ids && !latestIcvResult.active_fire_ids.has(recordId))) return null;
  transition({ type: "select_icv_record", record_id: fire.fire_id });
  setLayerFilter(ICV_SELECTED_LAYER, ["==", ["get", "geometry_id"], "__none__"]);
  if (icvDetail && icvDetailFields && icvSelectionSummary) {
    const gif = documentedIcvGif(fire);
    const rows = [["Fuente", "ICV / Generalitat Valenciana · registro administrativo"], ["Identificador del registro", fire.fire_id], ["Número PIF CV", fire.num_pif_cv || "No disponible"], ["Año", fire.year], ["Fecha de inicio", fire.start_date || "No disponible"], ["Fecha de extinción", fire.end_date || "No disponible"], ["Provincia declarada", fire.province || "No disponible"], ["Municipio declarado", fire.municipality_name || "No disponible"], ["Paraje", fire.place_name || "No disponible"], ["Superficie forestal declarada", formatOptionalArea(fire.reported_forest_area_ha)], ["Causa documentada", fire.cause_label || "No disponible"], ["Código de causa", fire.cause_code || "No disponible"], ["GIF", gif === true ? "Sí · criterio documentado ICV ≥500 ha" : gif === false ? "No · criterio documentado ICV ≥500 ha" : "No disponible"], ["Geometrías documentadas", Array.isArray(fire.geometry_ids) ? fire.geometry_ids.length : "No disponible"]];
    icvDetailFields.replaceChildren();
    for (const [label, value] of rows) { const term = document.createElement("dt"); term.textContent = label; const definition = document.createElement("dd"); definition.textContent = String(value); icvDetailFields.append(term, definition); }
    icvDetail.hidden = false;
    icvSelectionSummary.textContent = `source record: ${fire.fire_id} · ${Array.isArray(fire.geometry_ids) ? fire.geometry_ids.length : "?"} geometría(s) documentada(s); no se elige una geometría arbitrariamente.`;
  }
  return state.selected_icv_record_id;
}

function icvProvincesForView() {
  const b = map.getBounds();
  return explorationIcvProvinces(state, map.getZoom(), [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [...(provinceLayer?.byId.values() || [])]);
}

function currentIcvViewKey() {
  return JSON.stringify([icvLevelForZoom(map.getZoom()), icvProvincesForView()]);
}

async function refreshIcv() {
  if (!ICV_ENABLED || !icvLoader) return { status: "not_configured", metrics: { assets: 0, records: 0, geometries: 0 } };
  const generation = beginSourceLoad("icv");
  const coverage = effectiveCoverage(state, "icv");
  const provinces = icvProvincesForView();
  const viewKey = currentIcvViewKey();
  icvViewKey = viewKey;
  if (!state.icv_visible || !coverage || provinces.length === 0) {
    icvLoader.cancel(); setIcvCollection(); clearIcvSelection(); replaceStateUrl();
    latestIcvResult = { status: !coverage ? "no_coverage" : provinces.length ? "disabled" : "no_territory_coverage", features: [], metrics: { assets: 0, records: 0, geometries: 0 } };
    finishSourceLoad("icv", generation, "idle"); return latestIcvResult;
  }
  try {
    const level = icvLevelForZoom(map.getZoom());
    const result = await icvLoader.loadScope({ provinces, fromYear: coverage.from, toYear: coverage.to, level, municipalityId: state.municipality_id, filters: filtersForSource(state.filters, "icv") });
    if (result.status === "stale" || sourceLoadGeneration.icv !== generation || currentIcvViewKey() !== viewKey) return { status: "stale" };
    latestIcvResult = result; icvLoadedLevel = level; setIcvCollection(result.features);
    if (state.selected_icv_geometry_id && !findLoadedIcvGeometry(state.selected_icv_geometry_id)) clearIcvSelection();
    else if (state.selected_icv_record_id && !result.active_fire_ids?.has(state.selected_icv_record_id)) clearIcvSelection();
    finishSourceLoad("icv", generation, "ready"); return result;
  } catch (error) {
    if (sourceLoadGeneration.icv !== generation) return { status: "stale" };
    setIcvCollection(); clearIcvSelection(false);
    latestIcvResult = { status: "error", error: String(error), features: [], metrics: { assets: 0, records: 0, geometries: 0 } };
    finishSourceLoad("icv", generation, "error"); return latestIcvResult;
  }
}

function setEffisCollection(features = []) {
  map.getSource(EFFIS_SOURCE_ID)?.setData({ type: "FeatureCollection", features });
}

function clearEffisSelection(updateState = true) {
  closeDirectPopupFor("effis");
  if (updateState) state = reduceRuntimeState(state, { type: "clear_effis_geometry_selection" });
  setLayerFilter(EFFIS_SELECTED_LAYER, ["==", ["get", "geometry_id"], "__none__"]);
  clearHover("effis");
  if (effisDetail) effisDetail.hidden = true;
  if (effisSelectionSummary) effisSelectionSummary.textContent = "Pulsa o toca un perímetro satelital provisional para inspeccionarlo.";
  effisDetailFields?.replaceChildren();
}

function findLoadedEffisGeometry(geometryId) {
  return latestEffisResult.features?.find((feature) => String(feature.properties?.geometry_id) === geometryId) || null;
}

function selectEffisFeature(feature, { showDetail = true } = {}) {
  const properties = feature?.properties || {};
  if (!properties.geometry_id) return null;
  transition({ type: "select_effis_geometry", geometry_id: String(properties.geometry_id), year: Number(properties.year) });
  setLayerFilter(EFFIS_SELECTED_LAYER, ["==", ["get", "geometry_id"], String(properties.geometry_id)]);
  if (showDetail && effisDetail && effisDetailFields && effisSelectionSummary) {
    const rows = [["Fuente", "EFFIS / Copernicus EMS · perímetro satelital provisional"], ["Identificador de geometría", properties.geometry_id], ["ID EFFIS", properties.effis_id], ["Año", properties.year], ["Fecha EFFIS", properties.date || "No disponible"], ["Fecha final EFFIS", properties.final_date || "No disponible"], ["Provincia declarada", properties.province || "No disponible"], ["Municipio/commune declarado", properties.municipality_name || "No disponible"], ["Superficie cartografiada", formatOptionalArea(properties.mapped_area_ha)], ["Calidad geométrica", "B · teledetección provisional"], ["Snapshot", properties.acquired_at || "No disponible"]];
    effisDetailFields.replaceChildren();
    for (const [label, value] of rows) { const term = document.createElement("dt"); term.textContent = label; const definition = document.createElement("dd"); definition.textContent = value == null ? "No disponible" : String(value); effisDetailFields.append(term, definition); }
    effisDetail.hidden = false;
    effisSelectionSummary.textContent = `geometry_id: ${properties.geometry_id} · EFFIS ${properties.effis_id} · perímetro satelital provisional.`;
  } else if (!showDetail && effisDetail) effisDetail.hidden = true;
  return state.selected_effis_geometry_id;
}

async function refreshEffis() {
  if (!EFFIS_ENABLED || !effisLoader) return { status: "not_configured", metrics: { assets: 0, geometries: 0 } };
  const generation = beginSourceLoad("effis");
  const coverage = effectiveCoverage(state, "effis");
  if (!state.effis_visible || !coverage || !effisIntegratedTerritory(state)) {
    effisLoader.cancel(); setEffisCollection(); clearEffisSelection(false);
    latestEffisResult = { status: !coverage ? "no_coverage" : !effisIntegratedTerritory(state) ? "not_integrated_for_territory" : "disabled", features: [], metrics: { assets: 0, geometries: 0 } };
    finishSourceLoad("effis", generation, "idle"); return latestEffisResult;
  }
  try {
    const result = await effisLoader.loadScope({ fromYear: coverage.from, toYear: coverage.to, provinceId: state.province_id, municipalityId: state.municipality_id, filters: filtersForSource(state.filters, "effis") });
    if (result.status === "stale" || sourceLoadGeneration.effis !== generation || !effisIntegratedTerritory(state)) return { status: "stale" };
    latestEffisResult = result; setEffisCollection(result.features);
    if (state.selected_effis_geometry_id && !findLoadedEffisGeometry(state.selected_effis_geometry_id)) clearEffisSelection();
    finishSourceLoad("effis", generation, "ready"); return result;
  } catch (error) {
    setEffisCollection(); clearEffisSelection(false);
    latestEffisResult = { status: "error", error: String(error), features: [], metrics: { assets: 0, geometries: 0 } };
    finishSourceLoad("effis", generation, "error"); return latestEffisResult;
  }
}

async function setEgifScope(territoryId, { fit = true } = {}) {
  cancelMunicipalTransition();
  if (sourceLoadState.esfire30 === "error") esfireRecoveryRequested = true;
  territoryScope.value = territoryId;
  transition({ type: "set_scope", territory_id: territoryId });
  await Promise.all([territoryLayerReady, provinceLayerReady, municipalityLayerReady]);
  syncTerritoryLayer({ fit });
  municipalityReady = refreshMunicipalGeometry();
  await municipalityReady;
  return refreshSources();
}

async function setProvinceScope(provinceId, parentId, { fit = true } = {}) {
  if (sourceLoadState.esfire30 === "error") esfireRecoveryRequested = true;
  if (provinceParents.get(provinceId) !== parentId) throw new Error("Provincia y CCAA incompatibles");
  cancelMunicipalTransition();
  territoryScope.value = parentId;
  transition({ type: "set_province", province_id: provinceId, autonomous_community_id: parentId });
  await Promise.all([territoryLayerReady, provinceLayerReady, municipalityLayerReady]);
  syncTerritoryLayer({ fit });
  municipalityReady = refreshMunicipalGeometry();
  await municipalityReady;
  return refreshSources();
}

function municipalityParentEvent(row) {
  return row.province_id
    ? { type: "set_province", province_id: row.province_id, autonomous_community_id: row.autonomous_community_id }
    : { type: "set_scope", territory_id: row.autonomous_community_id };
}

function municipalityParentMatches(row) {
  return state.autonomous_community_id === row.autonomous_community_id
    && state.province_id === (row.province_id || null)
    && state.municipality_id == null;
}

async function setMunicipalityScope(municipalityId, { fit = true, restore = false, refresh = true } = {}) {
  if (sourceLoadState.esfire30 === "error") esfireRecoveryRequested = true;
  const transitionGeneration = ++municipalityTransitionGeneration;
  publishMunicipalLoad(transitionGeneration, "requested", { municipality_id: municipalityId, name: municipalityCatalog?.byId.get(municipalityId)?.official_name || null });
  try {
  const catalog = await ensureMunicipalityCatalog();
  if (transitionGeneration !== municipalityTransitionGeneration) return { status: "stale" };
  const row = catalog.byId.get(municipalityId);
  if (!row) throw new Error(`Municipio canónico desconocido: ${municipalityId}`);
  if (row.province_id && provinceParents.get(row.province_id) !== row.autonomous_community_id) throw new Error("Jerarquía municipal BDLJE/ES-2 incompatible");
  publishMunicipalLoad(transitionGeneration, "assets_loading", { name: row.official_name });
  territoryScope.value = row.autonomous_community_id;
  // La provincia/ciudad autónoma es un estado válido de respaldo. El municipio
  // no se confirma hasta validar su feature dentro del shard BDLJE actual.
  if (!municipalityParentMatches(row)) transition(municipalityParentEvent(row));
  await Promise.all([territoryLayerReady, provinceLayerReady, municipalityLayerReady]);
  if (transitionGeneration !== municipalityTransitionGeneration) return { status: "stale" };
  const loaded = await refreshMunicipalGeometry({ expectedMunicipalityId: row.municipality_id });
  if (transitionGeneration !== municipalityTransitionGeneration || loaded.status === "stale") return { status: "stale" };
  if (loaded.status !== "complete") {
    publishMunicipalLoad(transitionGeneration, "failed");
    // Se conserva el padre ya confirmado y se deja el error municipal aislado.
    syncTerritoryLayer({ fit: false });
    if (refresh) await refreshSources();
    return loaded;
  }
  transition({ type: "set_municipality", municipality_id: row.municipality_id, province_id: row.province_id, autonomous_community_id: row.autonomous_community_id });
  municipalityLayer?.setSelected(row.municipality_id);
  if (fit && !restore) municipalityLayer?.fit(row.bounds);
  syncTerritoryLayer({ fit: false });
  if (!refresh) return loaded;
  const result = await refreshSources();
  publishMunicipalLoad(transitionGeneration, Object.values(sourceLoadState).includes("error") ? "failed" : "data_ready");
  return result;
  } catch (error) {
    publishMunicipalLoad(transitionGeneration, "failed");
    return { status: transitionGeneration === municipalityTransitionGeneration ? "error" : "stale", error: String(error) };
  }
}

async function setSourceVisibility(sourceId, visible) {
  if (sourceId === "esfire30" && visible && esfireTransportError) esfireRecoveryRequested = true;
  transition({ type: "set_visibility", source_id: sourceId, visible });
  return refreshSources();
}

async function refreshSources() {
  const [result] = await Promise.all([refreshEgif(), refreshEsfireTerritoryFilter(), refreshIcv(), refreshEffis()]);
  renderRuntimeState();
  return result;
}

function findLoadedGeometry(geometryId) {
  return map.querySourceFeatures(SOURCE_ID, { sourceLayer: SOURCE_LAYER })
    .find((feature) => String(feature.properties?.geometry_id) === geometryId) || null;
}

async function restoreSelectionsFromState() {
  if (state.selected_egif_record_id) {
    if (!state.egif_visible || !effectiveCoverage(state, "egif")) clearEgifSelection();
    else {
      const selected = state.autonomous_community_id
        ? await selectEgifRecord(state.selected_egif_record_id)
        : await selectEgifHighlight(state.selected_egif_record_id);
      if (selected.status !== "complete") clearEgifSelection();
    }
  }
  if (state.selected_geometry_id) {
    if (esfireTerritory.status === "municipality" && !esfireTerritory.geometry_id_set?.has(state.selected_geometry_id)) {
      clearGeometrySelection();
      return;
    }
    const geometry = state.esfire30_visible && effectiveCoverage(state, "esfire30")
      ? findLoadedGeometry(state.selected_geometry_id) : null;
    if (geometry && featureMatchesTerritory(geometry.properties)) selectFeature(geometry);
    else clearGeometrySelection();
  }
  if (state.selected_icv_geometry_id) {
    const geometry = state.icv_visible && effectiveCoverage(state, "icv") && icvProvincesForView().length
      ? findLoadedIcvGeometry(state.selected_icv_geometry_id) : null;
    if (geometry) selectIcvFeature(geometry);
    else clearIcvSelection();
  } else if (state.selected_icv_record_id) {
    const record = state.icv_visible && effectiveCoverage(state, "icv") && icvProvincesForView().length
      ? selectIcvRecord(state.selected_icv_record_id) : null;
    if (!record) clearIcvSelection();
  }
  if (state.selected_effis_geometry_id) {
    const geometry = state.effis_visible && effectiveCoverage(state, "effis") && effisIntegratedTerritory(state)
      ? findLoadedEffisGeometry(state.selected_effis_geometry_id) : null;
    if (geometry) selectEffisFeature(geometry); else clearEffisSelection();
  }
}

async function restoreStateFromHash() {
  cancelExplorationClick();
  cancelMunicipalTransition();
  let restoreLoadGeneration = municipalityTransitionGeneration;
  try {
  const format = dispatchStateHash(location.hash);
  let parsed;
  let legacy = null;
  if (format === "gva_v1") {
    legacy = parseLegacyGvaV1State(location.hash);
    if (legacy.status === "complete") {
      if (/^\d{5}$/.test(legacy.state.municipality || "")) {
        publishMunicipalLoad(restoreLoadGeneration, "requested", { municipality_id: `ES:MUN:${legacy.state.municipality}`, name: null });
      }
      const catalog = await ensureMunicipalityCatalog();
      parsed = adaptLegacyGvaV1State(legacy.state, PROTOTYPE_DEFAULT_STATE, { territoryIds, provinceParents, municipalityParents: catalog.byId });
    } else parsed = { status: legacy.status, state: { ...PROTOTYPE_DEFAULT_STATE } };
  } else if (format === "national_v1") parsed = parseStateHash(location.hash, PROTOTYPE_DEFAULT_STATE, territoryIds, provinceParents);
  else parsed = { status: format === "absent" ? "absent" : "invalid", state: { ...PROTOTYPE_DEFAULT_STATE } };
  if (parsed.state.municipality_id && !legacy) {
    publishMunicipalLoad(restoreLoadGeneration, "requested", { municipality_id: parsed.state.municipality_id, name: null });
    const catalog = await ensureMunicipalityCatalog();
    parsed = parseStateHash(location.hash, PROTOTYPE_DEFAULT_STATE, territoryIds, provinceParents, catalog.byId);
  }
  if (parsed.status === "absent") return { status: "absent" };
  legacyHashActive = format === "gva_v1" && parsed.status === "complete";
  restoringFromUrl = true;
  const requestedState = parsed.state;
  const requestedSelections = {
    geometry_id: requestedState.selected_geometry_id,
    egif_record_id: requestedState.selected_egif_record_id,
    icv_geometry_id: requestedState.selected_icv_geometry_id,
    icv_record_id: requestedState.selected_icv_record_id,
    effis_geometry_id: requestedState.selected_effis_geometry_id,
  };
  // Una URL municipal se restaura primero en su padre válido. La transición
  // municipal posterior sólo la confirma si el shard actual está disponible.
  state = requestedState.municipality_id
    ? {
      ...requestedState,
      territory_scope: requestedState.province_id ? "province" : "autonomous_community",
      municipality_id: null,
      selected_geometry_id: null,
      selected_egif_record_id: null,
      selected_icv_geometry_id: null,
      selected_icv_record_id: null,
      selected_effis_geometry_id: null,
    }
    : requestedState;
  fromInput.value = String(state.from);
  toInput.value = String(state.to);
  territoryScope.value = state.autonomous_community_id || "ES";
  esfireVisibleInput.checked = state.esfire30_visible;
  egifVisibleInput.checked = state.egif_visible;
  if (icvVisibleInput) icvVisibleInput.checked = state.icv_visible;
  if (effisVisibleInput) effisVisibleInput.checked = state.effis_visible;
  legacyRestoreMapMovePending = legacyHashActive;
  map.jumpTo({ center: state.center, zoom: state.zoom });
  await Promise.all([territoryLayerReady, provinceLayerReady, municipalityLayerReady]);
  // La URL contiene su propia vista. Solo se resalta el límite; no se hace
  // fitBounds durante restauración porque destruiría center/zoom compartidos.
  syncTerritoryLayer();
  if (requestedState.municipality_id) {
    restoreLoadGeneration = municipalityTransitionGeneration + 1;
    await setMunicipalityScope(requestedState.municipality_id, { fit: false, restore: true, refresh: false });
  } else {
    await refreshMunicipalGeometry({ restore: true });
  }
  // El reducer invalida selecciones durante una transición territorial. Sólo
  // se reintentan tras confirmar el territorio efectivo y sus fuentes.
  state = {
    ...state,
    selected_geometry_id: requestedSelections.geometry_id,
    selected_egif_record_id: requestedSelections.egif_record_id,
    selected_icv_geometry_id: requestedSelections.icv_geometry_id,
    selected_icv_record_id: requestedSelections.icv_record_id,
    selected_effis_geometry_id: requestedSelections.effis_geometry_id,
  };
  applyFilters();
  await refreshSources();
  if (requestedState.municipality_id && state.municipality_id === requestedState.municipality_id) {
    publishMunicipalLoad(restoreLoadGeneration, Object.values(sourceLoadState).includes("error") ? "failed" : "data_ready");
  }
  await waitForIdle();
  await restoreSelectionsFromState();
  restoringFromUrl = false;
  stateHydrated = true;
  renderRuntimeState();
  replaceStateUrl();
  return { status: parsed.status, state: { ...state } };
  } catch (error) {
    if (municipalLoadState.phase !== "idle") publishMunicipalLoad(restoreLoadGeneration, "failed");
    restoringFromUrl = false;
    throw error;
  }
}

function selectFeature(feature) {
  const geometryId = feature?.properties?.geometry_id;
  if (!geometryId) return null;
  transition({ type: "select_geometry", geometry_id: String(geometryId), year: Number(feature.properties.year) });
  selectedGeometryProperties = { ...feature.properties };
  applyFilters();
  const year = feature.properties.year ?? "no disponible";
  selectionSummary.textContent = `geometry_id: ${state.selected_geometry_id} · año: ${year} · fuente: ESFire30 · superficie: no incluida en esta tesela diagnóstica.`;
  return state.selected_geometry_id;
}

function selectAtPoint(point) {
  const features = map.queryRenderedFeatures(point, { layers: [FILL_LAYER] });
  return features.length ? selectFeature(features[0]) : null;
}

function representativeCoordinate(geometry) {
  const visit = (value) => {
    if (!Array.isArray(value)) return null;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      return Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90 ? [value[0], value[1]] : null;
    }
    for (const nested of value) {
      const found = visit(nested);
      if (found) return found;
    }
    return null;
  };
  return visit(geometry?.coordinates);
}

function selectFirstRenderedFeature() {
  // `queryRenderedFeatures` sin punto devuelve solo las features visibles. El
  // smoke pasa después por la misma función `selectFeature` que usa el clic.
  const feature = map.queryRenderedFeatures({ layers: [FILL_LAYER] })[0];
  const selected = selectFeature(feature);
  return selected ? { geometry_id: selected, representative_coordinate: representativeCoordinate(feature.geometry) } : null;
}

function selectRenderedGeometryId(geometryId) {
  const feature = map.queryRenderedFeatures({ layers: [FILL_LAYER] })
    .find((candidate) => String(candidate.properties?.geometry_id) === geometryId);
  const selected = selectFeature(feature);
  return selected ? { geometry_id: selected, representative_coordinate: representativeCoordinate(feature.geometry) } : null;
}

function selectedTerritorySlots() {
  if (!selectedGeometryProperties) return null;
  const compact = { geometry_id: selectedGeometryProperties.geometry_id, year: selectedGeometryProperties.year };
  for (const key of ["ccaa_1", "ccaa_2", "ccaa_3", "prov_1", "prov_2", "prov_3"]) {
    compact[key] = Object.prototype.hasOwnProperty.call(selectedGeometryProperties, key) ? selectedGeometryProperties[key] : null;
  }
  return compact;
}

function waitForIdle(timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MapLibre no alcanzó idle")), timeoutMs);
    map.once("idle", () => { clearTimeout(timeout); resolve(); });
  });
}

async function rangeStats() {
  const response = await fetch("/__range_stats", { cache: "no-store" });
  return response.ok ? response.json() : { unavailable: true, status: response.status };
}

function remotePmtilesStats() {
  const rows = remotePmtilesRequests.map((row) => ({ ...row }));
  return {
    requests: rows.length,
    range_requests: rows.filter((row) => row.range && row.status === 206).length,
    response_bytes: rows.reduce((sum, row) => sum + (Number.isFinite(row.response_bytes) ? row.response_bytes : 0), 0),
    full_download_observed: rows.some((row) => row.method === "GET" && row.status === 200 && (row.response_bytes || 0) >= 63052056),
    rows,
  };
}

function resources() {
  const rows = performance.getEntriesByType("resource").filter((entry) => entry.name.includes(".pmtiles"));
  return {
    requests: rows.length,
    transfer_bytes: rows.reduce((sum, row) => sum + (row.transferSize || 0), 0),
    encoded_bytes: rows.reduce((sum, row) => sum + (row.encodedBodySize || 0), 0),
  };
}

function persistView() {
  const center = map.getCenter();
  state.center = [center.lng, center.lat];
  state.zoom = map.getZoom();
  if (legacyHashActive && legacyRestoreMapMovePending) {
    legacyRestoreMapMovePending = false;
    return;
  }
  replaceStateUrl();
}

function isEsfireTransportError(event) {
  const message = String(event?.error || event?.message || "");
  if (event?.sourceId) return event.sourceId === SOURCE_ID;
  return message.includes(archiveUrl) || message.includes(ARCHIVE_PATH.split("/").at(-1));
}

function isBasemapTransportError(event) {
  if (event?.sourceId) return event.sourceId === BASEMAP_SOURCE_ID;
  const message = String(event?.error || event?.message || "");
  return Boolean(BASEMAP_ARCHIVE_URL && message.includes(BASEMAP_ARCHIVE_URL))
    || message.includes("/data/basemap/protomaps/")
    || message.includes("Noto%20Sans%20Regular")
    || message.includes("Noto Sans Regular");
}

function markEsfireTransportError(event) {
  if (!isEsfireTransportError(event)) return;
  esfireTransportError = String(event?.error || event?.message || "Error de acceso al PMTiles ESFire30");
  esfireTerritory = { ...esfireTerritory, status: "error", error: esfireTransportError };
  if (state.selected_geometry_id) clearGeometrySelection();
  finishSourceLoad("esfire30", sourceLoadGeneration.esfire30, "error");
  renderRuntimeState();
}

map.on("movestart", cancelExplorationClick);
map.on("moveend", () => {
  persistView();
  if (stateHydrated && ICV_ENABLED && state.icv_visible && effectiveCoverage(state, "icv")) {
    if (currentIcvViewKey() !== icvViewKey) refreshIcv().then(renderRuntimeState).catch((error) => errors.push(String(error)));
  }
});
// Un único click consulta fills y outlines ya visibles. Esto conserva la
// selección exacta, evita duplicar una misma geometría y permite elegir cuando
// MapLibre devuelve varios perímetros que se solapan en el mismo punto.
map.on("click", handleMapPopupClick);
map.on("mouseenter", FILL_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mousemove", FILL_LAYER, (event) => showHover("esfire30", event.features?.[0]));
map.on("mouseleave", FILL_LAYER, () => { map.getCanvas().style.cursor = ""; clearHover("esfire30"); });
map.on("mouseenter", ICV_FILL_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mousemove", ICV_FILL_LAYER, (event) => showHover("icv", event.features?.[0]));
map.on("mouseleave", ICV_FILL_LAYER, () => { map.getCanvas().style.cursor = ""; clearHover("icv"); });
map.on("mouseenter", EFFIS_FILL_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mousemove", EFFIS_FILL_LAYER, (event) => showHover("effis", event.features?.[0]));
map.on("mouseleave", EFFIS_FILL_LAYER, () => { map.getCanvas().style.cursor = ""; clearHover("effis"); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && directPopup) { event.preventDefault(); closeDirectPopup(); }
});
map.on("error", (event) => {
  // El controlador productivo del mapa base registra el fallo y degrada a
  // BDLJE-only. No contaminar por ello el estado de ESFire30 ni el error
  // general del runtime de incendios.
  if (isBasemapTransportError(event)) return;
  errors.push(String(event?.error || "MapLibre error"));
  mapErrorEvents.push({ source_id: event?.sourceId || null, message: String(event?.error || event?.message || "MapLibre error") });
  markEsfireTransportError(event);
});
applyButton.addEventListener("click", () => { applyYears(); });
territoryScope.addEventListener("change", () => { setEgifScope(territoryScope.value); });
provinceScope.addEventListener("change", () => {
  const provinceId = provinceScope.value;
  if (provinceId) setProvinceScope(provinceId, state.autonomous_community_id);
  else if (state.autonomous_community_id) setEgifScope(state.autonomous_community_id, { fit: false });
});
municipalityScope.addEventListener("change", () => {
  const municipalityId = municipalityScope.value;
  if (municipalityId) setMunicipalityScope(municipalityId);
  else if (state.province_id) setProvinceScope(state.province_id, state.autonomous_community_id, { fit: false });
  else if (state.autonomous_community_id) setEgifScope(state.autonomous_community_id, { fit: false });
});
territoryBreadcrumb.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-territory-target]")?.dataset.territoryTarget;
  if (!target) return;
  if (target === "ES" || target.startsWith("ES:CCAA:")) setEgifScope(target);
  else if (target.startsWith("ES:PROV:")) setProvinceScope(target, provinceParents.get(target));
  else if (target.startsWith("ES:MUN:")) setMunicipalityScope(target);
});
esfireVisibleInput.addEventListener("change", () => { setSourceVisibility("esfire30", esfireVisibleInput.checked); });
egifVisibleInput.addEventListener("change", () => { setSourceVisibility("egif", egifVisibleInput.checked); });
if (icvVisibleInput) icvVisibleInput.addEventListener("change", () => { setSourceVisibility("icv", icvVisibleInput.checked); });
if (effisVisibleInput) effisVisibleInput.addEventListener("change", () => { setSourceVisibility("effis", effisVisibleInput.checked); });
egifRecordRows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-record-id]");
  if (button) selectEgifRecord(button.dataset.recordId);
});
egifRecordLookup.addEventListener("submit", (event) => {
  event.preventDefault();
  const recordId = egifRecordIdInput.value.trim();
  if (recordId) selectEgifRecord(recordId);
});
egifPagePrevious.addEventListener("click", () => { if (egifPage > 0) { egifPage -= 1; renderEgifPage(); } });
egifPageNext.addEventListener("click", () => { egifPage += 1; renderEgifPage(); });
copyStateLink.addEventListener("click", () => { copyCurrentStateLink(); });
window.addEventListener("hashchange", () => { restoreStateFromHash().catch((error) => errors.push(String(error))); });
window.addEventListener("popstate", () => { restoreStateFromHash().catch((error) => errors.push(String(error))); });

function activeRecordId(predicate = () => true, offset = 0) {
  let matches = 0;
  for (const loaded of activeInitialAssets) {
    const columns = loaded.data.columns;
    for (let ordinal = 0; ordinal < columns.record_id.length; ordinal += 1) {
      // El asset contiene todo el bloque: el smoke debe escoger una fila que
      // pertenezca al rango exacto activo, igual que la lista y la ficha.
      const year = columns.year[ordinal];
      if (year < state.from || year > state.to) continue;
      if (state.province_id && columns.province_id[ordinal] !== state.province_id) continue;
      if (state.municipality_id && columns.municipality_id[ordinal] !== state.municipality_id) continue;
      if (!predicate(columns, ordinal)) continue;
      if (matches === offset) return columns.record_id[ordinal];
      matches += 1;
    }
  }
  return null;
}

async function runDetailSmoke(mode) {
  const first = activeRecordId();
  if (!first) return { status: "missing_initial" };
  if (mode === "change_block") {
    fromInput.value = "2003";
    toInput.value = "2012";
    await applyYears();
    const recordId = activeRecordId();
    const result = await selectEgifRecord(recordId);
    return { mode, record_id: recordId, result };
  }
  if (mode === "null_municipality") {
    const recordId = activeRecordId((columns, ordinal) => columns.municipality_id[ordinal] == null);
    const result = await selectEgifRecord(recordId);
    return { mode, record_id: recordId, result };
  }
  if (mode === "same_asset") {
    const second = activeRecordId(() => true, 1);
    const firstResult = await selectEgifRecord(first);
    const secondResult = await selectEgifRecord(second);
    return { mode, first: { record_id: first, result: firstResult }, second: { record_id: second, result: secondResult } };
  }
  if (mode === "rapid") {
    const second = activeRecordId(() => true, 1);
    const firstPromise = selectEgifRecord(first);
    const secondPromise = selectEgifRecord(second);
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    return { mode, first: { record_id: first, result: firstResult }, second: { record_id: second, result: secondResult }, final_record_id: state.selected_egif_record_id };
  }
  const result = await selectEgifRecord(first);
  return { mode: mode || "single", record_id: first, result };
}

async function prepareStateRoundTrip(mode, name) {
  let egifSelection = null;
  if (mode === "egif" || mode === "both") egifSelection = await runDetailSmoke("single");
  if (mode === "geometry" || mode === "both") {
    const view = VIEWS[name] || VIEWS.pais_valencia;
    map.jumpTo({ center: view.center, zoom: view.zoom });
    await waitForIdle();
    selectFirstRenderedFeature();
  }
  const copied = await copyCurrentStateLink();
  return { copied, hash: serializeState(state), egif_selection: egifSelection, state: { ...state } };
}

async function runSmoke(name, initialReady = false) {
  if (!initialReady) await waitForIdle();
  const legacyInput = legacyHashActive ? location.hash : null;
  let legacyCopy = null;
  if (params.get("legacy_copy") === "1") legacyCopy = await copyCurrentStateLink();
  let legacyHistory = null;
  if (params.get("legacy_interaction") === "1" && legacyHashActive) {
    // Cambio explícito de toggle: promueve el enlace al formato nacional y
    // conserva una entrada para volver al hash #v=1 mediante Back.
    await setSourceVisibility("icv", state.icv_visible);
    const nativeHash = location.hash;
    history.back(); await new Promise((resolve) => setTimeout(resolve, 220)); await waitForIdle();
    const backHash = location.hash;
    history.forward(); await new Promise((resolve) => setTimeout(resolve, 220)); await waitForIdle();
    legacyHistory = { legacy_hash: legacyInput, native_hash: nativeHash, back_hash: backHash, forward_hash: location.hash, final_format: dispatchStateHash(location.hash) };
  }
  const preparedRoundTrip = params.get("state_prepare")
    ? await prepareStateRoundTrip(params.get("state_prepare"), name) : null;
  let cancellation = null;
  let territoryInteraction = null;
  if (params.get("territory_select") || params.get("territory_click")) {
    const territoryId = params.get("territory_select") || params.get("territory_click");
    if (params.get("territory_click")) {
      // Reutiliza exactamente la misma ruta que el listener de clic de la
      // feature administrativa, no una deducción desde ESFire30.
      await territoryLayer.selectFromFeature(territoryLayer.byId.get(territoryId));
    } else await setEgifScope(territoryId);
    await waitForIdle();
    territoryInteraction = { mode: params.get("territory_click") ? "click_feature" : "selector", territory_id: state.autonomous_community_id, center: [...state.center], zoom: state.zoom };
  }
  let provinceInteraction = null;
  if (params.get("province_select") || params.get("province_click")) {
    const provinceId = params.get("province_select") || params.get("province_click");
    const parentId = provinceParents.get(provinceId);
    if (!parentId) throw new Error(`Provincia de smoke desconocida: ${provinceId}`);
    if (state.autonomous_community_id !== parentId) await setEgifScope(parentId);
    if (params.get("province_click")) await provinceLayer.selectFromFeature(provinceLayer.byId.get(provinceId));
    else await setProvinceScope(provinceId, parentId);
    await waitForIdle();
    provinceInteraction = { mode: params.get("province_click") ? "click_feature" : "selector", province_id: state.province_id, parent_id: state.autonomous_community_id, center: [...state.center], zoom: state.zoom };
  }
  let municipalityInteraction = null;
  if (params.get("municipality_select") || params.get("municipality_click")) {
    const municipalityId = params.get("municipality_select") || params.get("municipality_click");
    const catalog = await ensureMunicipalityCatalog();
    const row = catalog.byId.get(municipalityId);
    if (!row) throw new Error(`Municipio de smoke desconocido: ${municipalityId}`);
    if (row.province_id && state.province_id !== row.province_id) await setProvinceScope(row.province_id, row.autonomous_community_id);
    else if (!row.province_id && state.autonomous_community_id !== row.autonomous_community_id) await setEgifScope(row.autonomous_community_id);
    if (params.get("municipality_click")) await municipalityLayer.selectFromFeature(municipalityLayer.getFeature(municipalityId));
    else await setMunicipalityScope(municipalityId, { fit: true });
    await waitForIdle();
    municipalityInteraction = { mode: params.get("municipality_click") ? "click_feature" : "selector", municipality_id: state.municipality_id, parent_id: municipalParentId(), center: [...state.center], zoom: state.zoom, filter_to_idle_ms: lastEsfireFilterStartedAt == null ? null : performance.now() - lastEsfireFilterStartedAt };
  }
  let consolidatedSelection = null;
  if (params.get("c3a_select_both") === "1") {
    // Las dos selecciones se provocan por rutas normales y se conservan como
    // identidades independientes: una ficha EGIF no destaca un perímetro.
    const recordId = activeRecordId();
    const egif = recordId ? await selectEgifRecord(recordId) : { status: "missing_initial" };
    const geometry = selectFirstRenderedFeature();
    consolidatedSelection = {
      egif_record_id: state.selected_egif_record_id,
      geometry_id: state.selected_geometry_id,
      egif_status: egif.status,
      geometry,
    };
  }
  let consolidatedRestore = null;
  if (params.get("c3a_roundtrip") === "1") {
    const before = serializeState(state);
    history.replaceState({ prototype: "es4c", consolidation: true }, "", `${location.pathname}${location.search}${before}`);
    await restoreStateFromHash();
    await waitForIdle();
    consolidatedRestore = {
      hash: before,
      center: [...state.center], zoom: state.zoom,
      selected_geometry_id: state.selected_geometry_id,
      selected_egif_record_id: state.selected_egif_record_id,
    };
  }
  let consolidatedRapidTransition = null;
  if (params.get("c3a_rapid_transition") === "1") {
    // Las cargas se solapan a propósito. La última transición territorial es
    // Elx y los loaders deben impedir que Galicia escriba resultados stale.
    const galicia = setEgifScope("ES:CCAA:12"); await Promise.resolve();
    const valenciana = setEgifScope("ES:CCAA:10"); await Promise.resolve();
    const alacant = setProvinceScope("ES:PROV:03", "ES:CCAA:10"); await Promise.resolve();
    const elx = setMunicipalityScope("ES:MUN:03065");
    const results = await Promise.all([galicia, valenciana, alacant, elx]);
    await waitForIdle();
    consolidatedRapidTransition = {
      results: results.map((value) => value?.status || null),
      final_territory: selectedTerritoryId(state),
      initial_assets: activeInitialAssets.map((asset) => asset.asset.asset_id),
      municipality_index_parent_assets: [...municipalityEsfireIndexLoader.parentCache.keys()],
    };
  }
  let municipalityIndexSequence = null;
  if (params.get("municipality_sequence")) {
    const ids = params.get("municipality_sequence").split(",").filter(Boolean);
    const steps = [];
    for (const municipalityId of ids) {
      await setMunicipalityScope(municipalityId, { fit: true });
      await waitForIdle();
      steps.push({ municipality_id: municipalityId, parent_id: municipalParentId(), strategy: esfireTerritory.strategy, geometry_ids: esfireTerritory.geometry_ids?.length ?? null, index_cached: Boolean(esfireTerritory.metrics?.cached) });
    }
    municipalityIndexSequence = { steps, cached_assets: [...municipalityEsfireIndexLoader.parentCache.keys()], national_loaded: Boolean(municipalityEsfireIndexLoader.national) };
  }
  let municipalitySelectionInvalidation = null;
  if (params.get("municipality_selection_change")) {
    const before = selectFirstRenderedFeature()?.geometry_id || null;
    await setMunicipalityScope(params.get("municipality_selection_change"), { fit: true });
    await waitForIdle();
    municipalitySelectionInvalidation = { before_geometry_id: before, after_geometry_id: state.selected_geometry_id, municipality_id: state.municipality_id };
  }
  let municipalityCancellation = null;
  if (params.get("municipality_rapid") === "1") {
    const catalog = await ensureMunicipalityCatalog();
    const barcelona = catalog.byProvince.get("ES:PROV:08")[0].municipality_id;
    const girona = catalog.byProvince.get("ES:PROV:17")[0].municipality_id;
    const obsolete = setMunicipalityScope(barcelona); await Promise.resolve(); const current = setMunicipalityScope(girona);
    const [oldResult, currentResult] = await Promise.all([obsolete, current]);
    municipalityCancellation = { obsolete_status: oldResult.status, current_status: currentResult.status, final_municipality_id: state.municipality_id };
  }
  let municipalityRetry = null;
  if (params.get("municipality_retry") === "1" && params.get("municipality_retry_id")) {
    const municipalityId = params.get("municipality_retry_id");
    const catalog = await ensureMunicipalityCatalog();
    const row = catalog.byId.get(municipalityId);
    if (!municipalityParentMatches(row)) {
      territoryScope.value = row.autonomous_community_id;
      transition(municipalityParentEvent(row));
      syncTerritoryLayer({ fit: false });
    }
    // Sólo el smoke despeja la caché: reproduce un retry de red sobre el
    // mismo shard sin convertir el fallo en un asset válido de sesión.
    municipalityLoader.assetCache.delete(row.asset_id);
    const first = await setMunicipalityScope(municipalityId, { fit: true });
    await waitForIdle();
    const before = { scope: state.territory_scope, municipality_id: state.municipality_id, load_status: latestMunicipalityResult?.status || null, first_status: first?.status || null };
    const retry = await setMunicipalityScope(municipalityId, { fit: true });
    await waitForIdle();
    municipalityRetry = { before, result: retry?.status || null, after: { scope: state.territory_scope, municipality_id: state.municipality_id, load_status: latestMunicipalityResult?.status || null } };
  }
  let pmtilesRetry = null;
  if (params.get("pmtiles_retry") === "1") {
    const before = sourceLoadState.esfire30;
    await setSourceVisibility("esfire30", false);
    await setSourceVisibility("esfire30", true);
    await waitForIdle();
    pmtilesRetry = { before, after: sourceLoadState.esfire30, territory_status: esfireTerritory.status };
  }
  if (params.get("province_sequence")) {
    const [first, second] = params.get("province_sequence").split(",", 2);
    const parentId = provinceParents.get(first);
    await setEgifScope(parentId);
    await setProvinceScope(first, parentId);
    const afterFirst = await rangeStats();
    await setProvinceScope(second, provinceParents.get(second));
    provinceInteraction = { mode: "same_ccaa_sequence", first, second, first_initial_requests: afterFirst.initial_requests, final_initial_requests: (await rangeStats()).initial_requests, province_id: state.province_id, parent_id: state.autonomous_community_id };
  }
  if (params.get("territory_up") === "1") {
    await setEgifScope(state.autonomous_community_id, { fit: false });
    await setEgifScope("ES", { fit: false });
    territoryInteraction = { mode: "breadcrumb_up", territory_id: state.autonomous_community_id, province_id: state.province_id };
  }
  if (params.get("egif_rapid") === "1") {
    const obsolete = setEgifScope("ES:CCAA:12");
    await Promise.resolve();
    const current = setEgifScope("ES:CCAA:17");
    const [obsoleteResult, currentResult] = await Promise.all([obsolete, current]);
    cancellation = { obsolete_status: obsoleteResult.status, current_status: currentResult.status, final_territory_id: state.autonomous_community_id };
  }
  let sourceToggle = null;
  if (params.get("source_toggle")) {
    const [sourceId, rawVisible] = params.get("source_toggle").split(":", 2);
    await setSourceVisibility(sourceId, rawVisible !== "off");
    sourceToggle = { source_id: sourceId, visible: state[`${sourceId}_visible`] };
  }
  let rangeCancellation = null;
  if (params.get("range_rapid") === "1") {
    fromInput.value = "1975";
    toInput.value = "1975";
    const obsolete = applyYears();
    fromInput.value = "1995";
    toInput.value = "1995";
    const current = applyYears();
    const [obsoleteResult, currentResult] = await Promise.all([obsolete, current]);
    rangeCancellation = { obsolete_status: obsoleteResult?.status, current_status: currentResult?.status, final_range: { from: state.from, to: state.to } };
  }
  let icvCancellation = null;
  if (params.get("icv_rapid") === "1") {
    const obsolete = setEgifScope("ES:CCAA:10");
    await Promise.resolve();
    const current = setEgifScope("ES:CCAA:12");
    const results = await Promise.all([obsolete, current]);
    await waitForIdle();
    icvCancellation = {
      results: results.map((value) => value?.status || null),
      final_territory: state.autonomous_community_id,
      icv_status: latestIcvResult.status,
      rendered_icv_features: map.queryRenderedFeatures({ layers: [ICV_FILL_LAYER] }).length,
    };
  }
  let effisCancellation = null;
  if (params.get("effis_rapid") === "1") {
    // La segunda transición sale deliberadamente del único ámbito integrado:
    // ninguna respuesta EFFIS de GVA puede sobrescribir el estado final.
    const obsolete = setEgifScope("ES:CCAA:10");
    await Promise.resolve();
    const current = setEgifScope("ES:CCAA:12");
    const results = await Promise.all([obsolete, current]);
    await waitForIdle();
    effisCancellation = {
      results: results.map((value) => value?.status || null),
      final_territory: state.autonomous_community_id,
      effis_status: latestEffisResult.status,
      cached_assets: [...(effisLoader?.assetCache?.keys() || [])],
    };
  }
  let historyRoundTrip = null;
  if (params.get("history_test") === "1") {
    const original = serializeState(state);
    const alternate = serializeState({ ...state, from: 1975, to: 1975, selected_geometry_id: null, selected_egif_record_id: null });
    history.pushState({ prototype: "es4c", test: "alternate" }, "", `${location.pathname}${location.search}${alternate}`);
    await restoreStateFromHash();
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 150));
    historyRoundTrip = { original, alternate, final_range: { from: state.from, to: state.to } };
  }
  const detail = params.get("egif_detail") ? await runDetailSmoke(params.get("egif_detail")) : null;
  const initial = {
    range: await rangeStats(), resources: resources(), usable_ms: performance.now() - startedAt,
    heap_delta_bytes: initialHeap === null || !performance.memory ? null : performance.memory.usedJSHeapSize - initialHeap,
    rendered_features: map.queryRenderedFeatures({ layers: [FILL_LAYER] }).length,
    source_feature_sample: map.querySourceFeatures(SOURCE_ID, { sourceLayer: SOURCE_LAYER })[0]?.properties ?? null,
    rendered_feature_sample: map.queryRenderedFeatures({ layers: [FILL_LAYER] })[0]?.properties ?? null,
  };
  const view = VIEWS[name] || VIEWS.spain;
  if (name !== "spain" && params.get("territory_restore") !== "1") {
    map.jumpTo({ center: view.center, zoom: view.zoom });
    await waitForIdle();
  }
  const afterNavigation = { range: await rangeStats(), resources: resources() };
  const requestedGeometryId = params.get("select_geometry_id");
  const requestedSelection = requestedGeometryId ? selectRenderedGeometryId(requestedGeometryId) : null;
  const requestedIcvGeometryId = params.get("select_icv_geometry_id");
  const requestedIcvSelection = requestedIcvGeometryId ? selectIcvFeature(findLoadedIcvGeometry(requestedIcvGeometryId)) : null;
  const requestedEffisGeometryId = params.get("select_effis_geometry_id");
  const requestedEffisSelection = requestedEffisGeometryId ? selectEffisFeature(findLoadedEffisGeometry(requestedEffisGeometryId)) : null;
  const selection = params.get("territory_restore") === "1" ? null : (requestedSelection || selectFirstRenderedFeature());
  let stableAtNextZoom = false;
  if (selection) {
    map.jumpTo({ center: selection.representative_coordinate || map.getCenter(), zoom: Math.min(map.getZoom() + 1, 14) });
    await waitForIdle();
    stableAtNextZoom = map.queryRenderedFeatures({ layers: [SELECTED_LAYER] })
      .some((feature) => String(feature.properties?.geometry_id) === selection.geometry_id);
  }
  const result = {
    prototype: "es4c1c2",
    scenario: name,
    sequence_step: params.get("sequence_step"),
    input_hash_format: incomingHashFormat,
    legacy_hash_active: legacyHashActive,
    legacy_copy: legacyCopy,
    legacy_history: legacyHistory,
    archive: ARCHIVE_PATH,
    archive_url: archiveUrl,
    source: "ESFire30",
    geometry_semantics: "documented_remote_sensing_perimeter",
    state: { ...state },
    initial,
    browser_range_fetch: await browserRangeFetch,
    remote_pmtiles: remotePmtilesStats(),
    after_navigation: afterNavigation,
    after_selection: { range: await rangeStats(), resources: resources() },
    selection: { ...selection, stable_at_next_zoom: stableAtNextZoom, territory_slots: selectedTerritorySlots() },
    icv_selection: requestedIcvSelection ? { geometry_id: requestedIcvSelection, fire_id: findLoadedIcvGeometry(requestedIcvSelection)?.properties?.fire_id || null } : null,
    effis: EFFIS_ENABLED ? { status: latestEffisResult.status, metrics: latestEffisResult.metrics, error: latestEffisResult.error || null, selected_geometry_id: state.selected_effis_geometry_id, selected_effis_id: state.selected_effis_geometry_id ? findLoadedEffisGeometry(state.selected_effis_geometry_id)?.properties?.effis_id || null : null, cached_assets: [...(effisLoader?.assetCache?.keys() || [])], municipality_filter_contract: "documented_snapshot_attribute" } : { status: "not_configured" },
    effis_selection: requestedEffisSelection ? { geometry_id: requestedEffisSelection, effis_id: findLoadedEffisGeometry(requestedEffisSelection)?.properties?.effis_id || null } : null,
    egif: latestEgifResult,
    icv: ICV_ENABLED ? {
      status: latestIcvResult.status,
      metrics: latestIcvResult.metrics,
      error: latestIcvResult.error || null,
      selected_geometry_id: state.selected_icv_geometry_id,
      selected_fire_id: state.selected_icv_geometry_id ? findLoadedIcvGeometry(state.selected_icv_geometry_id)?.properties?.fire_id || null : null,
      target_2024AL0005_geometries: latestIcvResult.metrics?.target_2024AL0005_geometries ?? 0,
      cached_assets: [...(icvLoader?.assetCache?.keys() || [])],
      municipality_filter_contract: "documented_administrative_municipality_id",
      load_level: icvLoadedLevel,
    } : { status: "not_configured" },
    egif_detail: detail,
    egif_record_browser: {
      visible: !egifRecordBrowser.hidden,
      rows: egifRecordRows.children.length,
      detail_visible: !egifDetail.hidden,
    },
    cancellation,
    range_cancellation: rangeCancellation,
    icv_cancellation: icvCancellation,
    effis_cancellation: effisCancellation,
    history_round_trip: historyRoundTrip,
    serialized_hash: preparedRoundTrip?.hash || null,
    copy_result: preparedRoundTrip?.copied || null,
    prepared_round_trip: preparedRoundTrip,
    source_toggle: sourceToggle,
    territory_layer: territoryLayer ? {
      loaded: true,
      selected_territory_id: state.autonomous_community_id,
      selected_bounds: state.autonomous_community_id ? territoryLayer.byId.get(state.autonomous_community_id)?.properties?.bounds || null : null,
      national_bounds: territoryLayer.collection.metadata?.national_bounds || null,
      interaction: territoryInteraction,
      error: latestMunicipalityResult?.error || null,
    } : { loaded: false, error: territoryLayerError },
    province_layer: provinceLayer ? {
      loaded: true,
      selected_province_id: state.province_id,
      selected_bounds: state.province_id ? provinceLayer.byId.get(state.province_id)?.properties?.bounds || null : null,
      interaction: provinceInteraction,
      error: null,
    } : { loaded: false, error: provinceLayerError },
    municipality_layer: municipalityLayer ? {
      loaded: true,
      load_status: latestMunicipalityResult?.status || null,
      selected_municipality_id: state.municipality_id,
      selected_bounds: state.municipality_id ? municipalityCatalog?.byId.get(state.municipality_id)?.bounds || null : null,
      catalog_loaded: Boolean(municipalityCatalog),
      cached_assets: [...municipalityLoader.assetCache.keys()],
      metrics: latestMunicipalityResult?.shard?.metrics || null,
      interaction: municipalityInteraction,
      cancellation: municipalityCancellation,
      error: null,
    } : { loaded: false, error: municipalityLayerError },
    municipality_esfire_index: {
      strategy_default: MUNICIPAL_INDEX_STRATEGY,
      cached_parent_assets: [...municipalityEsfireIndexLoader.parentCache.keys()],
      national_loaded: Boolean(municipalityEsfireIndexLoader.national),
      sequence: municipalityIndexSequence,
      selection_invalidation: municipalitySelectionInvalidation,
    },
    consolidation: { selection: consolidatedSelection, restore: consolidatedRestore, rapid_transition: consolidatedRapidTransition },
    municipality_retry: municipalityRetry,
    pmtiles_retry: pmtilesRetry,
    coverage: coverageStatePayload(),
    esfire30_territory_filter: {
      status: esfireTerritory.status, code: esfireTerritory.code, property_prefix: esfireTerritory.property_prefix,
      geometry_ids: esfireTerritory.geometry_ids?.length ?? null, strategy: esfireTerritory.strategy,
      index_metrics: esfireTerritory.metrics, expression_bytes: esfireTerritory.expression_bytes,
      prepare_ms: esfireTerritory.prepare_ms ?? null, filter_ms: esfireTerritory.filter_ms,
      error: esfireTerritory.error, external_index_loaded: false,
    },
    heap_delta_bytes: initialHeap === null || !performance.memory ? null : performance.memory.usedJSHeapSize - initialHeap,
    errors,
    map_error_events: mapErrorEvents,
  };
  output.textContent = JSON.stringify(result);
  output.dataset.complete = "true";
  return result;
}

map.once("idle", () => {
  Promise.all([territoryLayerReady, provinceLayerReady, municipalityLayerReady]).then(async () => {
    if (restoredHash.status !== "absent") {
      await restoreStateFromHash();
      const smoke = params.get("smoke");
      if (smoke) runSmoke(smoke, true).catch((error) => {
        output.textContent = JSON.stringify({ prototype: "es4c1c2", scenario: smoke, errors: [...errors, String(error)] });
        output.dataset.complete = "true";
      });
      return;
    }
    if (state.municipality_id) {
      const catalog = await ensureMunicipalityCatalog();
      const row = catalog.byId.get(state.municipality_id);
      if (!row || row.autonomous_community_id !== state.autonomous_community_id || row.province_id !== state.province_id) state = { ...PROTOTYPE_DEFAULT_STATE };
    }
    await refreshMunicipalGeometry({ restore: true });
    applyFilters();
    renderRuntimeState();
    egifReady = refreshSources().then(async () => {
    await restoreSelectionsFromState();
    stateHydrated = true;
    renderRuntimeState();
    replaceStateUrl();
    });
    const smoke = params.get("smoke");
    if (smoke) egifReady.then(() => runSmoke(smoke, true)).catch((error) => {
      output.textContent = JSON.stringify({ prototype: "es4c1c2", scenario: smoke, errors: [...errors, String(error)] });
      output.dataset.complete = "true";
    });
  });
});

window.__es4cRuntime = {
  map,
  getState: () => ({ ...state }),
  getMunicipalLoadState: () => ({ ...municipalLoadState }),
  getSourceLoadState: () => ({ ...sourceLoadState }),
  getTemporalVisualState: () => {
    const visual = currentTemporalVisual();
    return { ...visual, domain: visual.domain && { ...visual.domain } };
  },
  getDirectPopupState: directPopupState,
  closeDirectPopup,
  handleMapPopupClick,
  selectFirstRenderedFeature,
  applyYears,
  setEgifScope,
  setProvinceScope,
  setMunicipalityScope,
  refreshMunicipalGeometry,
  refreshEgif,
  refreshIcv,
  refreshEffis,
  refreshSources,
  setSourceVisibility,
  setAnalysisFilter,
  removeAnalysisFilter,
  clearAnalysisFilters,
  getFilterContracts: () => applicableFilterContracts(state).map((row) => ({ ...row })),
  getTerritoryName: canonicalTerritoryName,
  getFilterNotice: () => filterNotice,
  getHighlights,
  selectHighlight,
  selectEgifHighlight,
  clearSourceSelection,
  selectEgifRecord,
  selectIcvFeature,
  selectIcvRecord,
  selectEffisFeature,
  findLoadedIcvGeometry,
  serializeState: () => serializeState(state),
  restoreStateFromHash,
  copyCurrentStateLink,
  territoryLayerReady,
  getEgifResult: () => latestEgifResult,
  getIcvResult: () => latestIcvResult,
  getEffisResult: () => latestEffisResult,
  runSmoke,
  ARCHIVE_PATH,
  archiveUrl,
};
