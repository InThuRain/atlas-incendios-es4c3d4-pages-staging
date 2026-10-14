import { NATIONAL_SOURCE_REGISTRY } from "./source-registry.mjs";
import { NationalUxSummaryLoader } from "./ux-summary-loader.mjs";
import { createMetricsHistogramUi } from "./metrics-histogram.mjs";
import { createSafeFiltersUi } from "./safe-filters.mjs";
import { createHumanDetailsUi } from "./human-details.mjs";
import { createHighlightsUi } from "./highlights.mjs";

const GVA_ID = "ES:CCAA:10";
const ESFIRE30_NO_TERRITORY_COVERAGE = new Set([
  "ES:CCAA:04", "ES:CCAA:05", "ES:CCAA:18", "ES:CCAA:19",
  "ES:PROV:07", "ES:PROV:35", "ES:PROV:38",
]);
const SOURCE_IDS = ["esfire30", "egif", "icv", "effis"];

// Presentation only: asset loading is driven by the runtime's request generation.
export const MUNICIPAL_FEEDBACK_REVEAL_MS = 150;
export function municipalFeedbackPhase(load, { summaryReady, summaryError, mapReady }) {
  if (!load || load.phase === "idle") return "idle";
  if (load.phase === "failed" || summaryError) return "error";
  return load.phase === "data_ready" && summaryReady && mapReady ? "ready" : "loading";
}

export function createMunicipalFeedback(runtime, metricsUi) {
  const node = document.querySelector("#municipal-load-feedback");
  const shell = document.querySelector("#national-product-shell");
  const timeline = document.querySelector("#timeline-slot");
  let generation = -1, timer = null, revealed = false;
  const message = (text) => { if (node.textContent !== text) node.textContent = text; };
  const update = () => {
    const load = runtime.getMunicipalLoadState?.();
    if (load?.generation !== generation) {
      generation = load?.generation; clearTimeout(timer); timer = null; revealed = false;
    }
    const result = metricsUi.getState().result;
    const current = runtime.getState().municipality_id === load?.municipality_id;
    const summaryReady = current && result?.territory?.territory?.territory_id === load?.municipality_id
      && ["ready", "no-data"].includes(timeline.dataset.status);
    const sources = Object.values(runtime.getSourceLoadState?.() || {});
    const phase = municipalFeedbackPhase(load, { summaryReady, summaryError: current && (timeline.dataset.status === "error" || sources.includes("error")), mapReady: runtime.map.loaded() && !sources.includes("loading") });
    node.dataset.state = phase;
    shell.dataset.municipalPending = String(phase === "loading");
    // Reserve space, but announce just one human message, not internal stages.
    if (phase === "loading") {
      if (!revealed && timer === null) timer = setTimeout(() => { timer = null; revealed = true; update(); }, MUNICIPAL_FEEDBACK_REVEAL_MS);
      message(revealed ? `Cargando municipio${load.name ? `: ${load.name}` : ""}…` : "");
    } else {
      clearTimeout(timer); timer = null;
      message(phase === "error" ? "No se han podido cargar los datos del municipio. Puedes seguir explorando otros territorios." : "");
    }
    node.hidden = false;
    node.setAttribute("aria-busy", String(phase === "loading" && !revealed));
  };
  window.addEventListener("atlas:municipal-load", update);
  runtime.map.on("idle", update);
  const observer = new MutationObserver(update);
  observer.observe(timeline, { attributes: true, attributeFilter: ["data-status"] });
  update();
  return { update, destroy() { clearTimeout(timer); observer.disconnect(); window.removeEventListener("atlas:municipal-load", update); runtime.map.off("idle", update); } };
}
const SOURCE_PRESENTATION = Object.freeze({
  esfire30: { legend: "Perímetros Landsat", swatch: "esfire30" },
  egif: { legend: null, swatch: null },
  icv: { legend: "Perímetros oficiales", swatch: "icv" },
  effis: { legend: "Perímetros satelitales provisionales", swatch: "effis" },
});

function overlaps(from, to, coverage) {
  return Math.max(Number(from), coverage.from) <= Math.min(Number(to), coverage.to);
}

export function recommendedView(state) {
  const from = Number(state.from);
  const to = Number(state.to);
  const isGva = state.autonomous_community_id === GVA_ID;
  const territoryId = state.province_id || state.autonomous_community_id;
  const esfireTerritoryCovered = !ESFIRE30_NO_TERRITORY_COVERAGE.has(territoryId)
    && !ESFIRE30_NO_TERRITORY_COVERAGE.has(state.autonomous_community_id);
  const egif = overlaps(from, to, NATIONAL_SOURCE_REGISTRY.egif.coverage);
  let geometrySources;
  if (!isGva) {
    geometrySources = esfireTerritoryCovered && overlaps(from, to, NATIONAL_SOURCE_REGISTRY.esfire30.coverage) ? ["esfire30"] : [];
  } else {
    geometrySources = [];
    if (Math.max(from, 1985) <= Math.min(to, 1992)) geometrySources.push("esfire30");
    if (Math.max(from, 1993) <= Math.min(to, 2024)) geometrySources.push("icv");
    if (Math.max(from, 2025) <= Math.min(to, 2026)) geometrySources.push("effis");
  }
  const primary = geometrySources.length === 1 ? geometrySources[0]
    : isGva && geometrySources.length > 1 ? "multi_regime"
    : geometrySources[0] || (egif ? "egif" : null);
  const visibility = {
    esfire30: geometrySources.includes("esfire30"),
    egif,
    icv: geometrySources.includes("icv"),
    effis: geometrySources.includes("effis"),
  };
  let copy;
  if (primary === "esfire30") copy = "Perímetros obtenidos mediante imágenes Landsat, junto a los registros administrativos disponibles.";
  else if (primary === "icv") copy = "Incendios y perímetros oficiales documentados por la Generalitat Valenciana; los registros EGIF permanecen como información independiente.";
  else if (primary === "effis") copy = "Perímetros satelitales provisionales EFFIS para el periodo reciente; no representan el cierre anual.";
  else if (primary === "multi_regime") copy = "El periodo atraviesa varias fuentes: cada tramo se presenta por separado y sin sumar ni enlazar sus elementos.";
  else if (primary === "egif") copy = "Registros administrativos disponibles; no disponemos de una capa de perímetros para este contexto.";
  else copy = "No disponemos de registros ni perímetros integrados para este contexto.";
  return { title: "Vista recomendada", copy, primary, geometry_sources: geometrySources, visibility };
}

export function humanCoverageMessages(state, { zeroRelations = false, sourceError = false } = {}) {
  const from = Number(state.from);
  const to = Number(state.to);
  const territoryId = state.municipality_id || state.province_id || state.autonomous_community_id || "ES";
  const egifAvailable = overlaps(from, to, NATIONAL_SOURCE_REGISTRY.egif.coverage);
  const esfireTime = overlaps(from, to, NATIONAL_SOURCE_REGISTRY.esfire30.coverage);
  const esfireTerritory = !ESFIRE30_NO_TERRITORY_COVERAGE.has(territoryId)
    && !ESFIRE30_NO_TERRITORY_COVERAGE.has(state.autonomous_community_id)
    && !ESFIRE30_NO_TERRITORY_COVERAGE.has(state.province_id);
  if (sourceError) return "No se han podido cargar algunos perímetros. El resto del Atlas sigue disponible.";
  if (zeroRelations && esfireTime && esfireTerritory) return "No hay perímetros Landsat que intersecten este territorio en el periodo seleccionado.";
  const gvaAlternativeGeometry = state.autonomous_community_id === GVA_ID
    && (overlaps(from, to, NATIONAL_SOURCE_REGISTRY.icv.coverage) || overlaps(from, to, NATIONAL_SOURCE_REGISTRY.effis.coverage));
  if (gvaAlternativeGeometry) return "";
  if (!esfireTime || !esfireTerritory) {
    if (egifAvailable) return "Disponemos de registros administrativos, pero no de perímetros cartografiados para este territorio y periodo.";
    return "No disponemos de registros ni perímetros integrados para este territorio y periodo.";
  }
  const effectiveFrom = Math.max(from, 1985);
  const effectiveTo = Math.min(to, 2021);
  if (effectiveFrom !== from || effectiveTo !== to) {
    return `Periodo solicitado: ${from === to ? from : `${from}–${to}`}. Perímetros Landsat disponibles: ${effectiveFrom}–${effectiveTo}.`;
  }
  return "";
}

export function publicRuntimeMessage(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("no se ha identificado un municipio")) return "No se ha identificado un municipio único en este punto. Se conserva la vista.";
  if (text.includes("consultando el municipio")) return "Consultando el municipio en el límite oficial…";
  if (text.includes("error") || text.includes("no disponible:")) return "No se han podido cargar estos datos. El resto del Atlas sigue disponible.";
  if (text.includes("sin perímetros") && text.includes("cobertura disponible")) return "No hay perímetros que intersecten este territorio en el periodo seleccionado.";
  if (text.includes("sin cobertura")) return "No disponemos de este tipo de dato para el territorio o periodo seleccionado.";
  if (text.includes("cargando") || text.includes("calculando")) return "Cargando datos…";
  return "";
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits }).format(Number(value));
}

function appendMetric(list, label, value) {
  const term = document.createElement("dt"); term.textContent = label;
  const definition = document.createElement("dd"); definition.textContent = value;
  list.append(term, definition);
}

function currentTerritoryName() {
  const entries = [...document.querySelectorAll("#territory-breadcrumb button")].map((button) => button.textContent.trim()).filter(Boolean);
  return entries.length ? entries.join(" / ") : "España";
}

function sourceHasCoverage(state, sourceId) {
  if (!state[`${sourceId}_visible`]) return false;
  const source = NATIONAL_SOURCE_REGISTRY[sourceId];
  if (!source.coverage || !overlaps(state.from, state.to, source.coverage)) return false;
  if (sourceId === "icv" && !state.autonomous_community_id) return globalThis.__es4cRuntime?.getIcvResult()?.status === "complete";
  if ((sourceId === "icv" || sourceId === "effis") && state.autonomous_community_id !== GVA_ID) return false;
  const territoryId = state.province_id || state.autonomous_community_id;
  if (sourceId === "esfire30" && (ESFIRE30_NO_TERRITORY_COVERAGE.has(territoryId) || ESFIRE30_NO_TERRITORY_COVERAGE.has(state.autonomous_community_id))) return false;
  return true;
}

function buildLegend(state, view) {
  const list = document.querySelector("#user-map-legend");
  if (!list) return;
  list.replaceChildren();
  const temporal = globalThis.__es4cRuntime?.getTemporalVisualState?.();
  if (temporal?.domain) {
    const item = document.createElement("li"); item.className = "legend-temporal";
    item.setAttribute("aria-label", `Color temporal de perímetros: desde ${temporal.domain.from}, más antiguo, hasta ${temporal.domain.to}, más reciente.`);
    const heading = document.createElement("strong"); heading.textContent = "Año del perímetro";
    const scale = document.createElement("div"); scale.className = "temporal-scale";
    const old = document.createElement("span"); old.textContent = String(temporal.domain.from); old.className = "temporal-scale__year";
    const gradient = document.createElement("span"); gradient.className = "temporal-scale__gradient"; gradient.setAttribute("aria-hidden", "true");
    const recent = document.createElement("span"); recent.textContent = String(temporal.domain.to); recent.className = "temporal-scale__year";
    scale.append(old, gradient, recent);
    const labels = document.createElement("small"); labels.textContent = temporal.single_year ? "Año seleccionado" : "Más antiguo ← → más reciente";
    item.append(heading, scale, labels); list.append(item);
  }
  const entries = [{ label: "Límite administrativo actual", swatch: "boundary" }];
  const preferred = view.primary === "multi_regime" ? view.geometry_sources : [view.primary, ...SOURCE_IDS];
  const visibleEntries = [];
  for (const id of [...new Set(preferred)]) {
    const presentation = SOURCE_PRESENTATION[id];
    if (!presentation || !presentation.legend || !sourceHasCoverage(state, id)) continue;
    visibleEntries.push({ label: presentation.legend, swatch: presentation.swatch });
  }
  if (visibleEntries.length) {
    const heading = document.createElement("li"); heading.className = "legend-source-heading"; heading.textContent = "Capas"; list.append(heading);
  }
  for (const entry of [...entries, ...visibleEntries]) {
    const item = document.createElement("li");
    const swatch = document.createElement("span"); swatch.className = `legend-swatch legend-swatch--${entry.swatch}`; swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(entry.label)); list.append(item);
  }
}

const HUMAN_FIELD_PATTERNS = [
  /^año$/i, /^fecha de inicio$/i, /^fecha de extinción$/i, /^fecha effis$/i, /^fecha final effis$/i,
  /^ccaa$/i, /^provincia/i, /^municipio$/i, /^municipio declarado/i, /^paraje/i,
  /^superficie forestal declarada$/i, /^superficie cartografiada$/i, /^gif$/i,
  /^geometrías de este/i, /^geometrías documentadas$/i,
];

function syncHumanFields(sourceId, targetId) {
  const source = document.querySelector(sourceId);
  const target = document.querySelector(targetId);
  if (!source || !target) return;
  target.replaceChildren();
  const children = [...source.children];
  for (let index = 0; index + 1 < children.length; index += 2) {
    const term = children[index]; const definition = children[index + 1];
    if (term.tagName !== "DT" || definition.tagName !== "DD") continue;
    const label = term.textContent.trim(); const value = definition.textContent.trim();
    if (!HUMAN_FIELD_PATTERNS.some((pattern) => pattern.test(label))) continue;
    if (!value || /^(no disponible|no det\.|no mapeada|unmapped)$/i.test(value)) continue;
    if (/^causa$/i.test(label) && /código|sin normalizar/i.test(value)) continue;
    appendMetric(target, label, value);
  }
}

function syncSelections() {
  const selectionSummary = document.querySelector("#selection-summary");
  const esfireRaw = selectionSummary ? selectionSummary.textContent : "";
  const esfireHuman = document.querySelector("#selection-human-summary");
  if (esfireHuman) {
    const match = esfireRaw.match(/año:\s*([^·]+)/i);
    const year = match && match[1] ? match[1].trim() : null;
    esfireHuman.textContent = esfireRaw.includes("geometry_id:")
      ? `Perímetro obtenido mediante imágenes Landsat${year ? ` · ${year}` : ""}. No constituye cartografía oficial.`
      : "Pulsa o toca un perímetro para conocer su año y procedencia.";
  }
  syncHumanFields("#egif-detail-fields", "#egif-human-detail-fields");
  syncHumanFields("#icv-detail-fields", "#icv-human-detail-fields");
  syncHumanFields("#effis-detail-fields", "#effis-human-detail-fields");
}

function syncDetailsAccessibility(runtime) {
  document.querySelectorAll("details").forEach((details) => {
    const summary = details.querySelector(":scope > summary");
    if (summary) summary.setAttribute("aria-expanded", String(details.open));
  });
  if (runtime.map && runtime.map.resize) runtime.map.resize();
}

function syncPublicUi(runtime, metricsUi = null, filtersUi = null, detailsUi = null, highlightsUi = null) {
  const state = runtime.getState();
  const territory = currentTerritoryName();
  const period = state.from === state.to ? String(state.from) : `${state.from}–${state.to}`;
  syncCompactTerritoryHeading();
  document.querySelector("#header-period").textContent = period;
  const mapContext = document.querySelector("#map-context-territory");
  if (mapContext) mapContext.textContent = territory;
  document.querySelector("#municipality-current-note").hidden = !state.municipality_id;
  const view = recommendedView(state);
  document.querySelector("#recommended-view-title").textContent = view.title;
  document.querySelector("#recommended-view-copy").textContent = view.copy;
  document.querySelector("#national-product-shell").dataset.recommendedSource = view.primary || "none";
  document.querySelectorAll("[data-source-card]").forEach((card) => { card.dataset.recommended = String(view.geometry_sources.includes(card.dataset.sourceCard)); });
  const sourceCoverage = document.querySelector("#source-coverage");
  const internal = sourceCoverage ? sourceCoverage.textContent : "";
  const zeroRelations = /sin perímetros ESFire30 que intersecten/i.test(internal);
  const sourceError = /error de carga|no disponible por error/i.test(internal);
  const explorationNote = !state.autonomous_community_id && state.icv_visible
    ? " ICV se carga al acercarse al País Valencià (desde zoom 9). El resumen y el histograma siguen referidos a España; las fuentes no se suman."
    : "";
  document.querySelector("#human-coverage-message").textContent = humanCoverageMessages(state, { zeroRelations, sourceError }) + explorationNote;
  const territoryStatus = document.querySelector("#territory-status");
  const territoryInternal = territoryStatus ? territoryStatus.textContent : "";
  document.querySelector("#territory-public-status").textContent = publicRuntimeMessage(territoryInternal);
  if (metricsUi) metricsUi.update(state, view);
  highlightsUi?.update();
  filtersUi?.render();
  buildLegend(state, view);
  if (detailsUi) detailsUi.sync(); else syncSelections();
}

export function recommendedMapVisibility(state) {
  const visibility = { ...recommendedView(state).visibility };
  // Availability for lazy map exploration is distinct from the territorial
  // summary. The runtime loads nothing in the national overview.
  if (!state.autonomous_community_id) visibility.icv = overlaps(state.from, state.to, NATIONAL_SOURCE_REGISTRY.icv.coverage);
  return visibility;
}

async function applyRecommendedVisibility(runtime, isCurrent = () => true) {
  for (const sourceId of SOURCE_IDS) {
    if (!isCurrent()) return;
    const visibility = recommendedMapVisibility(runtime.getState());
    const key = `${sourceId}_visible`;
    if (Boolean(runtime.getState()[key]) !== visibility[sourceId]) await runtime.setSourceVisibility(sourceId, visibility[sourceId]);
  }
}

function waitUntil(predicate, timeoutMs = 30000) {
  const started = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (predicate() || performance.now() - started >= timeoutMs) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

// Layout state only: never writes territorial, filter, selection or camera state.
function syncCompactTerritoryHeading() {
  const heading = document.querySelector('#header-territory');
  heading.textContent = currentTerritoryName();
  heading.title = currentTerritoryName();
  const state = globalThis.__es4cRuntime.getState();
  document.querySelector('#mobile-map-period').textContent = state.from === state.to
    ? `Periodo: ${state.from}` : `Periodo: ${state.from}–${state.to}`;
}

export function initMobileMapFocus(runtime) {
  const shell = document.querySelector('#national-product-shell');
  const panel = document.querySelector('#explorer-panel');
  const route = document.querySelector('#territory-breadcrumb');
  const anchor = document.createComment('territorial route desktop position');
  route.before(anchor);
  const mobileRoute = document.querySelector('#mobile-territory-route');
  const controls = document.querySelector('#toggle-explorer');
  const fullButton = document.querySelector('#toggle-map-focus');
  const legendButton = document.querySelector('#toggle-map-legend');
  const legend = document.querySelector('#user-map-legend');
  const media = matchMedia('(max-width: 760px)');
  let panelOpen = false;
  let legendOpen = false;
  let full = false;
  let previous = null;
  const render = () => {
    syncCompactTerritoryHeading();
    const mobile = media.matches;
    panel.hidden = mobile && !panelOpen;
    legend.hidden = mobile && !legendOpen;
    legend.closest('.map-legend').hidden = mobile && !legendOpen;
    shell.classList.toggle('mobile-panel-collapsed', mobile && !panelOpen);
    shell.classList.toggle('mobile-map-full', mobile && full);
    document.body.classList.toggle('mobile-map-focused', mobile && full);
    controls.setAttribute('aria-expanded', String(!panel.hidden));
    controls.textContent = panel.hidden ? 'Controles' : 'Ocultar controles';
    legendButton.setAttribute('aria-expanded', String(!legend.hidden));
    fullButton.setAttribute('aria-pressed', String(full));
    fullButton.textContent = full ? 'Salir' : 'Mapa completo';
    requestAnimationFrame(() => runtime.map?.resize());
  };
  const leaveFull = () => {
    if (!full) return;
    full = false;
    panelOpen = previous.panelOpen;
    legendOpen = previous.legendOpen;
    render();
    window.scrollTo(0, previous.scrollY);
    fullButton.focus({ preventScroll: true });
  };
  controls.addEventListener('click', () => {
    const openingFromFull = full;
    if (full) leaveFull();
    panelOpen = openingFromFull || !panelOpen;
    render();
    // Keep the toggle beside the map in view. Do not scroll/focus the page away
    // from the only close action; the panel has its own scrollable mobile area.
  });
  legendButton.addEventListener('click', () => { legendOpen = !legendOpen; render(); });
  fullButton.addEventListener('click', () => {
    if (full) return leaveFull();
    previous = { panelOpen, legendOpen, scrollY: window.scrollY };
    full = true; panelOpen = false; legendOpen = false;
    render();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && full) { event.preventDefault(); leaveFull(); }
  });
  const adapt = () => {
    if (!media.matches) leaveFull();
    if (media.matches) mobileRoute.append(route); else anchor.after(route);
    render();
  };
  // Existing delegated breadcrumb click handler remains attached to this same node.
  // Current level is a focusable no-op, not a second territorial selector.
  const decorateRoute = () => {
    const buttons = [...route.querySelectorAll('button')];
    buttons.forEach((button, index) => {
      button.disabled = false;
      if (index === buttons.length - 1) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
    syncCompactTerritoryHeading();
    if (media.matches) requestAnimationFrame(() => { route.scrollLeft = route.scrollWidth; });
  };
  route.addEventListener('click', (event) => {
    if (event.target.closest('[aria-current="location"]')) event.stopImmediatePropagation();
  }, true);
  new MutationObserver(decorateRoute).observe(route, { childList: true });
  decorateRoute();
  media.addEventListener('change', adapt);
  adapt();
}

export function initNationalProductShell(runtime = globalThis.__es4cRuntime, config = globalThis.__ATLAS_NATIONAL_RUNTIME_CONFIG__, { initialUrlHadState = location.hash.length > 1 } = {}) {
  if (!runtime) throw new Error("El runtime nacional no está disponible");
  initMobileMapFocus(runtime);
  const summaryManifest = config && config.assets && config.assets.ux_summary && config.assets.ux_summary.manifest && config.assets.ux_summary.manifest.path;
  const summaryLoader = new NationalUxSummaryLoader({ manifestUrl: summaryManifest });
  let highlightsUi = null;
  const metricsUi = createMetricsHistogramUi({ runtime, loader: summaryLoader, onSeriesChange: () => highlightsUi?.update({ force: true }) });
  const municipalFeedback = createMunicipalFeedback(runtime, metricsUi);
  let detailsUi = null;
  let filtersUi = null;
  const syncAll = () => syncPublicUi(runtime, metricsUi, filtersUi, detailsUi, highlightsUi);
  detailsUi = createHumanDetailsUi({ runtime });
  filtersUi = createSafeFiltersUi({ runtime, onChange: async () => { await metricsUi.update(runtime.getState(), recommendedView(runtime.getState()), { force: true }); syncAll(); } });
  highlightsUi = createHighlightsUi({ runtime, getSelectedMetric: () => metricsUi.getState().selected_series_id });
  let sourceChoiceIsManual = initialUrlHadState;
  let recommendationGeneration = 0;
  const scheduleRecommendation = () => {
    if (sourceChoiceIsManual) return;
    const generation = ++recommendationGeneration;
    setTimeout(async () => {
      if (generation !== recommendationGeneration || sourceChoiceIsManual) return;
      await applyRecommendedVisibility(runtime, () => generation === recommendationGeneration && !sourceChoiceIsManual);
      syncAll();
    }, 30);
  };

  const onStateChange = (event) => {
    if (["set_scope", "set_province", "set_municipality", "set_range"].includes(event.detail?.type)) scheduleRecommendation();
  };
  window.addEventListener("atlas:statechange", onStateChange);

  document.querySelectorAll("#esfire30-visible, #egif-visible, #icv-visible, #effis-visible").forEach((input) => {
    input.addEventListener("change", (event) => { if (event.isTrusted) sourceChoiceIsManual = true; });
  });
  document.querySelectorAll("#territory-scope, #province-scope, #municipality-scope").forEach((input) => input.addEventListener("change", scheduleRecommendation));
  const applyYears = document.querySelector("#apply-years");
  if (applyYears) applyYears.addEventListener("click", scheduleRecommendation);
  document.querySelectorAll("details").forEach((details) => details.addEventListener("toggle", () => syncDetailsAccessibility(runtime)));
  window.addEventListener("resize", () => { if (runtime.map && runtime.map.resize) runtime.map.resize(); });
  window.addEventListener("hashchange", () => { sourceChoiceIsManual = true; setTimeout(syncAll, 50); });
  window.addEventListener("popstate", () => { sourceChoiceIsManual = true; setTimeout(syncAll, 50); });

  const watched = ["#source-coverage", "#runtime-state-summary", "#egif-status", "#egif-detail-fields", "#icv-detail-fields", "#effis-detail-fields", "#selection-summary"]
    .map((selector) => document.querySelector(selector)).filter(Boolean);
  const observer = new MutationObserver(syncAll);
  watched.forEach((node) => observer.observe(node, { childList: true, subtree: true, characterData: true }));
  syncDetailsAccessibility(runtime);
  syncAll();

  if (!initialUrlHadState) {
    waitUntil(() => location.hash.startsWith("#es4c-state-v1=")).then(() => {
      scheduleRecommendation();
      syncAll();
    });
  }
  globalThis.__nationalProductShell = {
    recommendedView: () => recommendedView(runtime.getState()),
    sync: syncAll,
    metrics: metricsUi,
    filters: filtersUi,
    details: detailsUi,
    highlights: highlightsUi,
    sourceChoiceIsManual: () => sourceChoiceIsManual,
    destroy: () => { window.removeEventListener("atlas:statechange", onStateChange); observer.disconnect(); municipalFeedback.destroy(); metricsUi.destroy(); highlightsUi.destroy(); },
  };
  return globalThis.__nationalProductShell;
}
