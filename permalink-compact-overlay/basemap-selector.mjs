/** Renders the central basemap state; permalink writes belong to the runtime. */
const SOURCE = 'atlas-alternative-background';
const HIDE = ['atlas-context-earth', 'atlas-context-landcover', 'atlas-context-natural-landuse', 'atlas-context-water'];
const link = (url, text) => `<a href="${url}" rel="license noopener">${text}</a>`;
export const BACKGROUNDS = Object.freeze({
  relief: {
    endpoint: 'https://servicios.idee.es/wmts/mdt', layer: 'Relieve', maxzoom: 16,
    paint: {'raster-opacity': 0.78, 'raster-saturation': -1},
    credit: link('https://www.scne.es/productos.php', 'Obra derivada de Relieve · CC BY 4.0 scne.es') + ' · ' +
      link('https://doi.org/10.5285/a29c5465-b138-234d-e053-6c86abc040b9', 'GEBCO 2021') + ' · ' +
      link('https://emodnet.ec.europa.eu/en/bathymetry', 'EMODnet Bathymetry Consortium 2020') + ' · ' +
      link('https://land.copernicus.eu/', 'DEM-v1.1 © Unión Europea, Copernicus Land Monitoring Service 2018, EEA'),
  },
  ortho: {
    endpoint: 'https://www.ign.es/wmts/pnoa-ma', layer: 'OI.OrthoimageCoverage', maxzoom: 19,
    paint: {'raster-opacity': 0.80, 'raster-saturation': -0.65, 'raster-brightness-min': 0.20},
    credit: link('https://www.scne.es/productos.php', 'Obra derivada de PNOA · CC BY 4.0 scne.es') + ' · ' +
      link('https://pnoa.ign.es/pnoa-imagen/visualizadores-y-servicios-web', 'Sentinel-2 · MODIS/NASA · Melilla: Pléiades Neo © Airbus DS (2022)'),
  },
});

export function tileTemplate(option) {
  return `${option.endpoint}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${option.layer}&STYLE=Default&FORMAT=image%2Fjpeg&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

export function initBasemapSelector(runtime) {
  const map = runtime.map;
  const field = document.querySelector('#basemap-choice');
  const status = document.querySelector('#basemap-status');
  const attribution = document.querySelector('.map-attribution');
  const originalCredit = attribution.innerHTML;
  const originalVisibility = new Map();
  // Applied layer cache only, never a second preference or restoration source.
  let active = 'map', generation = 0, timer = null;
  const state = {get active() {return active;}, change};

  function render(message = status.textContent) {
    for (const input of field.querySelectorAll('input')) input.checked = input.value === runtime.getState().basemap;
    status.textContent = message;
    attribution.innerHTML = originalCredit + (active === 'map' ? '' : ' · ' + BACKGROUNDS[active].credit);
  }
  function removeAlternative() {
    clearTimeout(timer);
    if (map.getLayer(SOURCE)) map.removeLayer(SOURCE);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    for (const [id, visibility] of originalVisibility) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
    originalVisibility.clear();
  }
  function fallback() {
    if (active === 'map') return;
    change('map');
    render('No se ha podido cargar este fondo. Se mantiene el mapa habitual.');
  }
  function change(value) {
    runtime.setBasemap(value);
  }
  function sync() {
    render();
    // The optional context installs asynchronously after the shell. Wait for
    // its layers (or explicit fallback), not for another data hydration.
    const context = globalThis.__atlasBasemapContext;
    if (!context || !['ready', 'fallback_bdlje_only'].includes(context.status)) return;
    if (!map.getLayer('official-ccaa-territories-fill')) return;
    apply(runtime.getState().basemap);
  }
  function apply(value) {
    if (value !== 'map' && !Object.hasOwn(BACKGROUNDS, value)) return;
    if (value === active) return;
    const token = ++generation;
    removeAlternative();
    active = value;
    render('');
    if (value === 'map') return;
    try {
      const option = BACKGROUNDS[value];
      // Keep the normal land/water colours under the translucent alternative.
      // Only the broad context fills are hidden; labels, roads and BDLJE stay.
      const before = map.getLayer('atlas-context-earth') ? 'atlas-context-earth' : 'official-ccaa-territories-fill';
      map.addSource(SOURCE, {type: 'raster', tiles: [tileTemplate(option)], tileSize: 256,
        minzoom: 0, maxzoom: option.maxzoom, scheme: 'xyz'});
      map.addLayer({id: SOURCE, type: 'raster', source: SOURCE,
        paint: {'raster-fade-duration': 0, ...option.paint}}, before);
      for (const id of HIDE) if (map.getLayer(id)) {
        originalVisibility.set(id, map.getLayoutProperty(id, 'visibility') || 'visible');
        map.setLayoutProperty(id, 'visibility', 'none');
      }
      timer = setTimeout(() => {if (token === generation && !map.isSourceLoaded(SOURCE)) fallback();}, 15000);
    } catch (_) { fallback(); }
  }
  const onError = event => {
    if (event.sourceId === SOURCE) fallback();
  };
  const onData = event => {
    if (event.sourceId === SOURCE && event.isSourceLoaded) clearTimeout(timer);
  };
  const onChange = event => {if (event.target.name === 'basemap') change(event.target.value);};
  map.on('error', onError);
  map.on('sourcedata', onData);
  field.addEventListener('change', onChange);
  window.addEventListener('atlas:statechange', sync);
  map.on('idle', sync);
  sync();
  state.destroy = () => {
    window.removeEventListener('atlas:statechange', sync);
    map.off('idle', sync);
    removeAlternative();clearTimeout(timer);
    field.removeEventListener('change', onChange);
    map.off('error', onError);map.off('sourcedata', onData);
  };
  return state;
}
