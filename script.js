// ── CONFIGURATION ─────────────────────────────────────────────
const CONFIG = {
  populationTifPath: 'data/landscan-southasia-2024-compressed.tif',
  builtAreaTifPath: 'data/pct_builtup_southasia2024-compressed_reproj.tif'
};

// ── MAP INIT ──────────────────────────────────────────────────
const map = L.map('map', { center: [22.5, 82.0], zoom: 5, zoomControl: true });

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri',
  maxZoom: 18
}).addTo(map);

// ── STATE VARIABLES ───────────────────────────────────────────
const layers = {
  population: null,
  builtArea: null
};

// ── GEOTIFF LOADER ────────────────────────────────────────────
async function loadTifData(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  
  const arrayBuffer = await resp.arrayBuffer();
  const tif = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tif.getImage();
  
  const bbox = image.getBoundingBox();
  const fileDir = image.getFileDirectory();
  
  let nodata = fileDir.GDAL_NODATA !== undefined ? parseFloat(fileDir.GDAL_NODATA) : null;
  if (nodata === null && url.includes('GHS')) {
    nodata = 4294967295;
  }
  
  const rasters = await image.readRasters({ interleave: false });

  return {
    data: rasters[0],
    nodata: nodata,
    width: image.getWidth(),
    height: image.getHeight(),
    originX: bbox[0],
    originY: bbox[3],
    pixelW: (bbox[2] - bbox[0]) / image.getWidth(),
    pixelH: (bbox[3] - bbox[1]) / image.getHeight()
  };
}

// ── RASTER LAYER GENERATOR ────────────────────────────────────
function createRasterLayer(tifInfo, colorScaleFn) {
  const layer = L.gridLayer({ opacity: 0.7, zIndex: 5 });

  layer.createTile = function(coords, done) {
    const tile = L.DomUtil.create('canvas', 'leaflet-tile');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const ctx = tile.getContext('2d');

    const nwPoint = coords.scaleBy(size);
    const { data, nodata, width, height, originX, originY, pixelW, pixelH } = tifInfo;

    const imgData = ctx.createImageData(size.x, size.y);
    const pixels = imgData.data;

    for (let y = 0; y < size.y; y++) {
      for (let x = 0; x < size.x; x++) {
        const pt = nwPoint.add(L.point(x, y));
        const latlng = map.unproject(pt, coords.z);

        const col = Math.floor((latlng.lng - originX) / pixelW);
        const row = Math.floor((originY - latlng.lat) / pixelH);

        const idx = (y * size.x + x) * 4;

        if (col >= 0 && col < width && row >= 0 && row < height) {
          const val = data[row * width + col];
          
          if (val !== null && val !== undefined && !isNaN(val) && val !== nodata && val > 0) {
            const [r, g, b, a] = colorScaleFn(val);
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
          } else {
            pixels[idx + 3] = 0; // Transparent
          }
        } else {
          pixels[idx + 3] = 0; // Out of bounds
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    setTimeout(() => done(null, tile), 0);
    return tile;
  };

  return layer;
}

// ── COLOR SCALES ──────────────────────────────────────────────
function getPopulationColor(val) {
  if (val < 10)      return [255, 255, 178, 100];
  if (val < 50)      return [254, 204, 92,  160];
  if (val < 200)     return [253, 141, 60,  200];
  if (val < 500)     return [240, 59,  32,  230];
  return [189, 0, 38, 255]; // > 500
}

function getBuiltAreaColor(val) {
  // Built surface percentage categories using Green, Yellow, and Dark Brown
  if (val < 10)  return [120, 198, 121, 160]; // Soft Green (< 10%)
  if (val < 20)  return [254, 217, 118, 200]; // Warm Yellow (10% – 20%)
  return [96,  56,  19,   230];                 // Dark Brown (>= 20%)
}

// ── LEGEND CONTROL ────────────────────────────────────────────
const LegendControl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd: function() {
    const div = L.DomUtil.create('div', 'info legend');
    div.id = 'map-legend';
    div.style.background = 'white';
    div.style.padding = '10px 14px';
    div.style.borderRadius = '8px';
    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    div.style.border = '1px solid #dde0d8';
    div.style.fontFamily = 'inherit';
    div.style.fontSize = '0.8rem';
    div.style.lineHeight = '1.4';
    div.style.color = '#1a1e18';
    div.innerHTML = '<b>Legend</b><br><span style="color:#6b7268;">Toggle a layer to view details</span>';
    return div;
  }
});

const legend = new LegendControl().addTo(map);

function updateLegend() {
  const legendDiv = document.getElementById('map-legend');
  const hasPop = map.hasLayer(layers.population);
  const hasBuilt = map.hasLayer(layers.builtArea);

  if (!hasPop && !hasBuilt) {
    legendDiv.innerHTML = '<b>Legend</b><br><span style="color:#6b7268;">No layers active</span>';
    return;
  }

  let html = '';

  if (hasPop) {
    html += `<b>Population Density</b><br>` +
      `<i style="background:rgba(255,255,178,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &lt; 10<br>` +
      `<i style="background:rgba(254,204,92,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> 10 – 49<br>` +
      `<i style="background:rgba(253,141,60,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> 50 – 199<br>` +
      `<i style="background:rgba(240,59,32,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> 200 – 499<br>` +
      `<i style="background:rgba(189,0,38,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &ge; 500<br>`;
  }

  if (hasPop && hasBuilt) {
    html += `<hr style="border:none; border-top:1px solid #dde0d8; margin:6px 0;">`;
  }

  if (hasBuilt) {
    html += `<b>Built-up Percentage (%)</b><br>` +
      `<i style="background:rgba(120,198,121,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &lt; 10%<br>` +
      `<i style="background:rgba(254,217,118,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> 10% – 20%<br>` +
      `<i style="background:rgba(96,56,19,0.8); width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &ge; 20%<br>`;
  }

  legendDiv.innerHTML = html;
}

// ── INIT LAYERS & UI ──────────────────────────────────────────
async function init() {
  const btnPop = document.getElementById('btn-population');
  const btnBuilt = document.getElementById('btn-builtarea');

  try {
    const popInfo = await loadTifData(CONFIG.populationTifPath);
    layers.population = createRasterLayer(popInfo, getPopulationColor);
    btnPop.textContent = 'Toggle Population';
    btnPop.disabled = false;
  } catch (err) {
    btnPop.textContent = 'Pop Error (Check Path)';
    console.error('Failed to load Population TIF:', err);
  }

  try {
    const builtInfo = await loadTifData(CONFIG.builtAreaTifPath);
    layers.builtArea = createRasterLayer(builtInfo, getBuiltAreaColor);
    btnBuilt.textContent = 'Toggle Built Area';
    btnBuilt.disabled = false;
  } catch (err) {
    btnBuilt.textContent = 'Built Error (Check Path)';
    console.error('Failed to load Built Area TIF:', err);
  }

  function handleToggle(layerName, btnElement) {
    const layer = layers[layerName];
    if (!layer) return;

    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
      btnElement.classList.remove('active');
    } else {
      map.addLayer(layer);
      btnElement.classList.add('active');
    }
    updateLegend();
  }

  btnPop.addEventListener('click', () => handleToggle('population', btnPop));
  btnBuilt.addEventListener('click', () => handleToggle('builtArea', btnBuilt));
}

// Start application
init();