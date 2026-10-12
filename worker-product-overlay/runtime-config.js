// Generado por scripts/build_national_frontend.py; no editar.
globalThis.__ATLAS_NATIONAL_RUNTIME_CONFIG__ = {
  "asset_base_url": "./",
  "runtime_entry": "./runtime/app.js",
  "maplibre_script": "./vendor/maplibre-gl-5.16.0.js",
  "pmtiles_protocol_module": "../vendor/pmtiles-4.3.0.mjs",
  "assets": {
    "basemap": {
      "enabled": true,
      "role": "cartographic_context",
      "source_id": "protomaps-context",
      "version": "protomaps-20260902-z12",
      "pmtiles": {
        "logical_id": "protomaps-20260902-z12",
        "path": "https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev/basemap.pmtiles",
        "bytes": 293324998,
        "sha256": "72bb270ff6fc18ccba3042834f9a9eb72901c243e7dec88b3ebb63eaafaeb729",
        "required": false
      },
      "glyphs": {
        "fontstack": "Noto Sans Regular",
        "template": "data/basemap/protomaps/20260902-z12/72bb270ff6fc18ccba3042834f9a9eb72901c243e7dec88b3ebb63eaafaeb729/fonts/{fontstack}/{range}.pbf",
        "ranges": [
          "0-255",
          "256-511",
          "512-767",
          "768-1023",
          "1024-1279",
          "1536-1791",
          "7680-7935",
          "8192-8447",
          "11520-11775"
        ],
        "file_count": 9,
        "total_bytes": 909374,
        "required": false
      },
      "manifest": {
        "path": "data/basemap/protomaps/20260902-z12/72bb270ff6fc18ccba3042834f9a9eb72901c243e7dec88b3ebb63eaafaeb729/manifest.json",
        "required": false
      },
      "attribution": "Protomaps · © OpenStreetMap contributors · Obra derivada de BDLJE CC-BY 4.0 ign.es",
      "runtime_external_domains": [],
      "api_keys_required": false
    },
    "esfire30": {
      "pmtiles": {
        "logical_id": "esfire30-national-fidelity-territories",
        "path": "https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev/esfire30.pmtiles",
        "bytes": 63052056,
        "sha256": "3c6eb10ba146008cdabf36646d48a4c7a92c1c1357ad90679f6b5dce42013cfe",
        "source": "ESFire30 v1",
        "required": true
      }
    },
    "egif": {
      "manifest": {
        "logical_id": "egif-national-web-manifest-2026-08-27",
        "path": "data/egif/v1/2026-08-27/manifest.json",
        "required": true
      }
    },
    "icv": {
      "manifest": {
        "logical_id": "gva-icv-public-manifest",
        "path": "data/web/gva/manifest.json",
        "required": true
      },
      "asset_base_url": {
        "path": "./",
        "required": true
      }
    },
    "effis": {
      "manifest": {
        "logical_id": "gva-recent-effis-public-manifest",
        "path": "data/web/gva/manifest.json",
        "required": true
      },
      "asset_base_url": {
        "path": "./",
        "required": true
      }
    },
    "territories": {
      "ccaa": {
        "path": "data/territories/spain/v1/ccaa.geojson",
        "required": true
      },
      "provinces": {
        "path": "data/territories/spain/v1/provinces.geojson",
        "required": true
      },
      "catalog": {
        "path": "data/territories/spain/territories-2026-01-01.json",
        "required": true
      }
    },
    "municipalities": {
      "catalog": {
        "path": "data/territories/spain/v1/municipality-catalog.json",
        "required": true
      },
      "shards_root": {
        "path": "data/territories/spain/v1/municipalities",
        "required": true
      }
    },
    "esfire30_municipality_indexes": {
      "root": {
        "path": "data/esfire30/v1/municipality-index",
        "required": true
      },
      "manifest": {
        "path": "data/esfire30/v1/municipality-index/manifest.json",
        "required": true
      }
    },
    "ux_summary": {
      "manifest": {
        "logical_id": "national-ux-summary-v1",
        "path": "data/summary/national-ux-summary-v1/manifest.json",
        "schema_version": "national-ux-summary-v1",
        "required": true
      }
    },
    "highlights": {
      "manifest": {
        "logical_id": "national-highlights-v1",
        "path": "data/highlights/national-highlights-v1/manifest.json",
        "schema_version": "national-highlights-v1",
        "required": true
      }
    }
  }
};
