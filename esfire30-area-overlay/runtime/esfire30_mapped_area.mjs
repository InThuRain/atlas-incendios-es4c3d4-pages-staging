/** Offline geometry areas only. No geometry download, matching or aggregation. */
const METHOD = "WGS84_GEODESIC_ED50_41_IGN_GRID";
const years = new Map();

export async function mappedAreaFor(geometryId) {
  const match = /^esfire30:v1:(\d{4}):\d+$/.exec(String(geometryId));
  if (!match || Number(match[1]) < 1985 || Number(match[1]) > 2021) return null;
  const year = Number(match[1]);
  if (!years.has(year)) {
    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(new URL(`../data/esfire30-mapped-area/${year}.json`, import.meta.url), { signal: controller.signal });
        if (!response.ok) throw new Error("ESFire30 area unavailable");
        const data = await response.json();
        if (data.schema !== "esfire30-mapped-area-v1" || data.year !== year || data.method !== METHOD ||
            data.provenance !== "DERIVED_FROM_GEOMETRY" || data.units !== "ha" || !data.areas) throw new Error("ESFire30 area contract");
        return data.areas;
      } finally { clearTimeout(timer); }
    })();
    years.set(year, request);
    // Bounded cache. Eviction does not cancel another open popup's request.
    if (years.size > 3) years.delete(years.keys().next().value);
    request.catch(() => { if (years.get(year) === request) years.delete(year); });
  }
  try {
    const areas = await years.get(year);
    const value = Object.prototype.hasOwnProperty.call(areas, geometryId) ? areas[geometryId] : null;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  } catch (_) { return null; }
}
