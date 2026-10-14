/** Modelos puros para el popup inmediato de perímetros.
 *
 * El popup no convierte fuentes en un incidente canónico: cada modelo describe
 * exclusivamente la geometría pulsada y sus campos ya cargados. Los detalles
 * técnicos continúan en la ficha existente, bajo una acción explícita.
 */

function useful(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  return text !== "" && !/^(no disponible|unknown|null|undefined)$/i.test(text);
}

function number(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function humanDate(value) {
  if (!useful(value)) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}

export function humanArea(value) {
  const parsed = number(value);
  return parsed === null ? null : `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(parsed)} ha`;
}

function rows(values) {
  return values.filter(([, value]) => useful(value));
}

/** Crea solamente campos humanos, seguros y ya disponibles en memoria. */
export function popupModel({ sourceId, properties = {}, record = null, territoryName = "España" }) {
  if (sourceId === "icv") {
    const date = humanDate(record && record.start_date) || humanDate(properties.date) || String((record && record.year) || properties.year || "");
    const gif = record && record.reported_forest_area_ha != null && Number(record.reported_forest_area_ha) >= 500;
    return {
      sourceId, title: "Incendio documentado", sourceLabel: "ICV · Generalitat Valenciana",
      rows: rows([
        ["Fecha", date], ["Paraje", record && record.place_name], ["Municipio", record && record.municipality_name],
        ["Provincia", (record && record.province) || properties.province], ["Superficie forestal declarada", humanArea(record && record.reported_forest_area_ha)],
        ["Causa", record && record.cause_label], ["GIF", gif ? "Sí" : null],
      ]), note: null,
    };
  }
  if (sourceId === "effis") {
    const date = humanDate(properties.date) || String(properties.year || "");
    return {
      sourceId, title: "Perímetro satelital", sourceLabel: "EFFIS · Copernicus",
      rows: rows([
        ["Fecha", date], ["Municipio", properties.municipality_name], ["Provincia", properties.province], ["Territorio", territoryName],
        ["Área cartografiada", humanArea(properties.mapped_area_ha)],
      ]), note: "Dato satelital provisional.",
    };
  }
  return {
    sourceId: "esfire30", title: "Perímetro observado por satélite", sourceLabel: "ESFire30",
    rows: rows([["Año", properties.year], ["Territorio consultado", territoryName]]),
    note: "Perímetro obtenido mediante imágenes Landsat; no constituye cartografía oficial.",
  };
}

/**
 * Quita la duplicación fill/outline sin fundir fuentes y ordena los candidatos
 * más recientes primero. Un empate conserva el orden de renderizado MapLibre.
 */
export function dedupeAndSortHits(hits) {
  const unique = new Map();
  for (const hit of hits) {
    const geometryId = String(hit.feature && hit.feature.properties && hit.feature.properties.geometry_id || "");
    if (!geometryId) continue;
    const key = `${hit.sourceId}|${geometryId}`;
    if (!unique.has(key)) unique.set(key, { ...hit, geometryId });
  }
  return [...unique.values()].sort((left, right) => {
    const byYear = Number(right.feature && right.feature.properties && right.feature.properties.year || 0) - Number(left.feature && left.feature.properties && left.feature.properties.year || 0);
    return byYear || left.renderOrder - right.renderOrder;
  });
}

export function chooserLabel(hit) {
  const properties = hit.feature && hit.feature.properties || {};
  const year = properties.year || "Fecha no disponible";
  const model = hit.model || {};
  const row = (model.rows || []).find(([label]) => label === "Paraje" || label === "Municipio");
  const place = (row && row[1]) || model.title || "Perímetro";
  return `${year} · ${place}`;
}
