const MAX_ITEMS = 10;
const INITIAL_ITEMS = 3;

export const HIGHLIGHT_CONTRACTS = Object.freeze({
  egif: { source_label: "EGIF", title: "Registros con mayor superficie declarada", metric_id: "egif_declared_forest_area_ha", ordering: "descending", unit: "ha", area_field: "reported_forest_area_ha", identity: "record_id" },
  icv: { source_label: "ICV", title: "Incendios documentados con mayor superficie declarada", metric_id: "icv_declared_forest_area_ha", ordering: "descending", unit: "ha", area_field: "reported_forest_area_ha", identity: "fire_id" },
  effis: { source_label: "EFFIS", title: "Perímetros provisionales con mayor área cartografiada", metric_id: "effis_mapped_area_ha", ordering: "descending", unit: "ha", area_field: "mapped_area_ha", identity: "geometry_id" },
  esfire30: { source_label: "ESFire30", title: "Perímetros Landsat destacados", metric_id: null, ordering: null, unit: null, status: "DEFERRED_NO_SAFE_RANKING_METRIC" },
});

export function sourceForMetric(metricId) {
  return ["egif", "icv", "effis", "esfire30"].find((source) => String(metricId || "").startsWith(`${source}_`)) || "egif";
}

export function rankHighlightItems(sourceId, items, limit = MAX_ITEMS) {
  const contract = HIGHLIGHT_CONTRACTS[sourceId];
  if (!contract || !contract.area_field) return [];
  const identity = contract.identity;
  return (items || []).filter((item) => {
    const row = sourceId === "effis" ? item.properties || {} : item;
    return typeof row[contract.area_field] === "number" && Number.isFinite(row[contract.area_field]);
  }).sort((left, right) => {
    const a = sourceId === "effis" ? left.properties : left;
    const b = sourceId === "effis" ? right.properties : right;
    return b[contract.area_field] - a[contract.area_field] || String(a[identity]).localeCompare(String(b[identity]));
  }).slice(0, Math.min(MAX_ITEMS, Math.max(1, Number(limit) || MAX_ITEMS)));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatArea(value) {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value)} ha`;
}

function rowOf(sourceId, item) { return sourceId === "effis" ? item.properties || {} : item; }

function dateLabel(sourceId, row) {
  const raw = sourceId === "effis" ? row.date : sourceId === "icv" ? row.start_date : null;
  if (!raw) return String(row.year || "Fecha no disponible");
  const parts = String(raw).slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(raw);
}

async function placeLabel(sourceId, row, runtime) {
  if (sourceId === "icv") return [row.municipality_name, row.province].filter(Boolean).join(" · ") || "Comunitat Valenciana";
  if (sourceId === "effis") return [row.municipality_name, row.province].filter(Boolean).join(" · ") || "Comunitat Valenciana";
  const municipality = row.municipality_name || (row.municipality_id ? await runtime.getTerritoryName(row.municipality_id) : null);
  const province = row.province_name || (row.province_id ? await runtime.getTerritoryName(row.province_id) : null);
  if (!municipality && province) return `Municipio no resuelto · ${province}`;
  return [municipality, province].filter(Boolean).join(" · ") || "Municipio no resuelto";
}

export function createHighlightsUi({ runtime, getSelectedMetric = () => "egif_record_count" } = {}) {
  const section = document.querySelector("#highlights-slot");
  const title = document.querySelector("#highlights-title");
  const contractNode = document.querySelector("#highlights-contract");
  const status = document.querySelector("#highlights-status");
  const list = document.querySelector("#highlights-list");
  const more = document.querySelector("#highlights-more");
  let visible = INITIAL_ITEMS;
  let generation = 0;
  let lastKey = null;
  let current = null;

  async function renderItems(sourceId, result, activeGeneration) {
    const contract = HIGHLIGHT_CONTRACTS[sourceId];
    const ranked = rankHighlightItems(sourceId, result.items, MAX_ITEMS);
    const prepared = await Promise.all(ranked.map(async (item) => {
      const row = rowOf(sourceId, item);
      return { item, row, place: await placeLabel(sourceId, row, runtime) };
    }));
    if (activeGeneration !== generation) return;
    list.replaceChildren();
    for (const { item, row, place } of prepared.slice(0, visible)) {
      const li = element("li", `highlight-item highlight-item--${sourceId}`);
      const button = element("button", "highlight-button"); button.type = "button";
      const heading = element("span", "highlight-primary", `${dateLabel(sourceId, row)} · ${place}`);
      const measure = element("strong", "highlight-measure", formatArea(row[contract.area_field]));
      const source = element("small", "highlight-source", sourceId === "effis" ? "EFFIS · provisional · datos a 19/08/2026" : contract.source_label);
      button.append(heading, measure, source);
      button.addEventListener("click", async () => {
        status.textContent = "Abriendo la ficha…";
        const selected = await runtime.selectHighlight(sourceId, item);
        status.textContent = selected && selected.status === "error" ? "No se ha podido abrir la ficha; el resto del Atlas sigue disponible." : `Ficha abierta · ${contract.source_label}.`;
        const detail = document.querySelector(`[data-detail-card="${sourceId}"]`);
        const detailHeading = detail && detail.querySelector("h3");
        if (detailHeading) detailHeading.focus({ preventScroll: false });
      });
      li.append(button); list.append(li);
    }
    more.hidden = ranked.length <= INITIAL_ITEMS;
    more.textContent = visible < ranked.length ? `Ver más (${Math.min(MAX_ITEMS, ranked.length)})` : "Ver menos";
    status.textContent = ranked.length
      ? `${ranked.length} elementos ordenados dentro del territorio, periodo y filtros de ${contract.source_label}.`
      : `No hay elementos con una superficie conocida que cumplan estos filtros en ${contract.source_label}.`;
    section.dataset.status = ranked.length ? "ready" : "empty";
    current = { source_id: sourceId, contract, result, ranked, visible };
  }

  async function update({ force = false } = {}) {
    const state = runtime.getState();
    const sourceId = sourceForMetric(getSelectedMetric());
    const key = `${sourceId}|${state.from}|${state.to}|${state.territory_scope}|${state.autonomous_community_id}|${state.province_id}|${state.municipality_id}|${JSON.stringify(state.filters || [])}|${state[`${sourceId}_visible`]}`;
    if (!force && key === lastKey) return;
    lastKey = key; visible = INITIAL_ITEMS;
    const activeGeneration = ++generation;
    const contract = HIGHLIGHT_CONTRACTS[sourceId];
    title.textContent = contract.title;
    contractNode.textContent = contract.metric_id
      ? `Fuente: ${contract.source_label} · superficie en ${contract.unit}`
      : "ESFire30 no contiene una magnitud individual segura para ordenar sus perímetros.";
    list.replaceChildren(); more.hidden = true; section.dataset.source = sourceId;
    if (sourceId === "esfire30") {
      status.textContent = "No disponemos de superficies individuales comparables para ordenar estos perímetros.";
      section.dataset.status = "deferred"; current = { source_id: sourceId, contract, result: { status: "deferred_no_safe_ranking_metric", items: [] }, ranked: [], visible }; return;
    }
    if (!state[`${sourceId}_visible`]) {
      status.textContent = `La fuente ${contract.source_label} está desactivada.`; section.dataset.status = "inactive"; return;
    }
    status.textContent = "Preparando destacados…"; section.dataset.status = "loading";
    try {
      const result = await runtime.getHighlights(sourceId, MAX_ITEMS);
      if (activeGeneration !== generation) return;
      await renderItems(sourceId, result, activeGeneration);
    } catch (_error) {
      if (activeGeneration !== generation) return;
      status.textContent = "No se han podido preparar los destacados. El mapa y el resto del Atlas siguen disponibles.";
      section.dataset.status = "error";
    }
  }

  more.addEventListener("click", async () => {
    visible = visible > INITIAL_ITEMS ? INITIAL_ITEMS : MAX_ITEMS;
    if (current) await renderItems(current.source_id, current.result, generation);
  });

  return { update, getState: () => current ? { ...current, ranked: [...current.ranked] } : null, destroy() { generation += 1; } };
}
