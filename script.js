// ── CONFIGURATION ─────────────────────────────────────────────
const CONFIG = {
  populationTifPath: 'data/landscan-southasia-2024-compressed.tif',
  builtAreaTifPath: 'data/GHS-Southasia-2024-4326-deflate.tif'
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

let rawTifInfo = {
  population: null,
  builtArea: null
};

let extractedPop = { urban: 0, rural: 0 };
let activeBounds = null;

// ── HELPER: GEODESIC AREA CALCULATION ────────────────────────
function calculateBoundsAreaKm2(bounds) {
  if (!bounds) return 0;
  const lat1 = bounds.getSouth() * Math.PI / 180;
  const lat2 = bounds.getNorth() * Math.PI / 180;
  const dLng = Math.abs(bounds.getEast() - bounds.getWest()) * Math.PI / 180;
  const R = 6371.0088; // Earth's mean radius in kilometers
  
  return R * R * dLng * Math.abs(Math.sin(lat2) - Math.sin(lat1));
}

// ── LEAFLET DRAW TOOLBAR ──────────────────────────────────────
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
  draw: {
    polyline: false,
    polygon: false,
    circle: false,
    marker: false,
    circlemarker: false,
    rectangle: {
      shapeOptions: {
        color: '#164D12',
        weight: 2,
        fillOpacity: 0.15
      }
    }
  },
  edit: {
    featureGroup: drawnItems,
    remove: true
  }
});
map.addControl(drawControl);

// ---------- Prominent Draw Button Integration ----------
const drawRectBtn = document.getElementById('drawRectBtn');

if (drawRectBtn) {
  drawRectBtn.addEventListener('click', function() {
    for (let id in drawControl._toolbars.draw._modes) {
      if (drawControl._toolbars.draw._modes[id].handler instanceof L.Draw.Rectangle) {
        drawControl._toolbars.draw._modes[id].handler.enable();
        break;
      }
    }
  });
}

map.on(L.Draw.Event.CREATED, function (e) {
  drawnItems.clearLayers();
  const layer = e.layer;
  drawnItems.addLayer(layer);
  
  activeBounds = layer.getBounds();
  updateAOIState(true);
  extractPopulationsInBounds(activeBounds);
});

map.on(L.Draw.Event.EDITED, function (e) {
  e.layers.eachLayer(function (layer) {
    activeBounds = layer.getBounds();
    extractPopulationsInBounds(activeBounds);
  });
});

map.on(L.Draw.Event.DELETED, function () {
  clearBoundingBox();
});

function clearBoundingBox() {
  drawnItems.clearLayers();
  activeBounds = null;
  updateAOIState(false);
  extractPopulationsInBounds(null);
}

function updateAOIState(hasBox) {
  const statusEl = document.getElementById('selection-status');
  const clearBtn = document.getElementById('btn-clear-box');
  
  if (hasBox) {
    statusEl.textContent = "Filtered Box Area";
    statusEl.style.color = "#164D12";
    clearBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = "Entire Extent";
    statusEl.style.color = "#6b7268";
    clearBtn.classList.add('hidden');
  }
}

document.getElementById('btn-clear-box').addEventListener('click', clearBoundingBox);

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
            pixels[idx + 3] = 0;
          }
        } else {
          pixels[idx + 3] = 0;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    setTimeout(() => done(null, tile), 0);
    return tile;
  };

  return layer;
}

// ── COLOR SCALES & LEGEND ─────────────────────────────────────
function getPopulationColor(val) {
  if (val < 10)      return [255, 255, 178, 100];
  if (val < 50)      return [254, 204, 92,  160];
  if (val < 200)     return [253, 141, 60,  200];
  if (val < 500)     return [240, 59,  32,  230];
  return [189, 0, 38, 255];
}

function getBuiltAreaColor(val) {
  if (val < 10)  return [120, 198, 121, 160];
  if (val < 20)  return [254, 217, 118, 200];
  return [96,  56,  19,   230];
}

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

// ── EXTRACTION & BOUNDING BOX STATS ──────────────────────────
function extractPopulationsInBounds(bounds = null) {
  if (!rawTifInfo.population || !rawTifInfo.builtArea) return;

  const popInfo = rawTifInfo.population;
  const builtInfo = rawTifInfo.builtArea;

  let urbanPop = 0;
  let ruralPop = 0;
  let totalBuiltPctSum = 0;
  let validBuiltPixelCount = 0;
  let urbanPixelCount = 0;

  // IMPORTANT:
  // Population and built-up rasters may have different dimensions/resolutions.
  // Do NOT use the same row/column index for both rasters.
  // For every LandScan population cell, find the corresponding pct_built cell
  // using the geographic centre of the population cell.

  let colMin = 0;
  let colMax = popInfo.width - 1;
  let rowMin = 0;
  let rowMax = popInfo.height - 1;

  if (bounds) {
    const minLng = bounds.getWest();
    const maxLng = bounds.getEast();
    const minLat = bounds.getSouth();
    const maxLat = bounds.getNorth();

    // Use pixel centres so that we classify the actual cells whose centres
    // fall inside the selected bounding box.
    colMin = Math.max(
      0,
      Math.ceil((minLng - popInfo.originX) / popInfo.pixelW - 0.5)
    );
    colMax = Math.min(
      popInfo.width - 1,
      Math.floor((maxLng - popInfo.originX) / popInfo.pixelW - 0.5)
    );

    rowMin = Math.max(
      0,
      Math.ceil((popInfo.originY - maxLat) / popInfo.pixelH - 0.5)
    );
    rowMax = Math.min(
      popInfo.height - 1,
      Math.floor((popInfo.originY - minLat) / popInfo.pixelH - 0.5)
    );
  }

  // No valid population cells in the selected box.
  if (colMin > colMax || rowMin > rowMax) {
    extractedPop.urban = 0;
    extractedPop.rural = 0;

    const areaKm2 = bounds ? calculateBoundsAreaKm2(bounds) : 0;
    document.getElementById('stat-area').textContent =
      bounds ? `${areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²` : 'Full Extent';
    document.getElementById('stat-pop-urban').textContent = '0';
    document.getElementById('stat-pop-rural').textContent = '0';
    document.getElementById('stat-pop-total').textContent = '0';
    // document.getElementById('stat-built-share').textContent = '0.0%';
    document.getElementById('stat-built-share').textContent = '0.0%';

    runCalculations();
    return;
  }

  for (let r = rowMin; r <= rowMax; r++) {
    // Geographic centre of this LandScan cell.
    const y = popInfo.originY - (r + 0.5) * popInfo.pixelH;

    for (let c = colMin; c <= colMax; c++) {
      const x = popInfo.originX + (c + 0.5) * popInfo.pixelW;

      const popIdx = r * popInfo.width + c;
      const popVal = popInfo.data[popIdx];

      const isPopValid =
        popVal !== null &&
        popVal !== undefined &&
        Number.isFinite(Number(popVal)) &&
        popVal !== popInfo.nodata &&
        popVal > 0;

      if (!isPopValid) continue;

      // Find the pct_built cell containing the centre of this population cell.
      const builtCol = Math.floor((x - builtInfo.originX) / builtInfo.pixelW);
      const builtRow = Math.floor((builtInfo.originY - y) / builtInfo.pixelH);

      if (
        builtCol < 0 ||
        builtCol >= builtInfo.width ||
        builtRow < 0 ||
        builtRow >= builtInfo.height
      ) {
        continue;
      }

      const builtIdx = builtRow * builtInfo.width + builtCol;
      const builtVal = builtInfo.data[builtIdx];

      const builtPctRaw = Number(builtVal);

      const isBuiltValid =
        builtVal !== null &&
        builtVal !== undefined &&
        Number.isFinite(builtPctRaw) &&
        builtVal !== builtInfo.nodata &&
        // GHS no-data pixels are sometimes stored as 4294967295 (unsigned) but
        // read back as -1 (signed) depending on the raster's sample format, so
        // the nodata check above can miss them. Built % is only ever 0-100,
        // so range-guard as a belt-and-braces filter against any mis-typed
        // sentinel value slipping through.
        builtPctRaw >= 0 &&
        builtPctRaw <= 100;

      if (!isBuiltValid) continue;

      const builtPct = builtPctRaw;

      totalBuiltPctSum += builtPct;
      validBuiltPixelCount++;

      // THE CLASSIFICATION:
      // pct_built >= 20%  -> URBAN
      // pct_built < 20%   -> RURAL
      if (builtPct >= 20) {
        urbanPop += Number(popVal);
        urbanPixelCount++;
      } else {
        ruralPop += Number(popVal);
      }
    }
  }

  extractedPop.urban = urbanPop;
  extractedPop.rural = ruralPop;

  // Calculate Box Stats
  const areaKm2 = bounds ? calculateBoundsAreaKm2(bounds) : 0;
  const meanBuiltShare =
    validBuiltPixelCount > 0
      ? totalBuiltPctSum / validBuiltPixelCount
      : 0;
  const urbanAreaPct =
    validBuiltPixelCount > 0
      ? (urbanPixelCount / validBuiltPixelCount) * 100
      : 0;

  // Render Stats
  document.getElementById('stat-area').textContent =
    bounds
      ? `${areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`
      : 'Full Extent';

  document.getElementById('stat-pop-urban').textContent =
    urbanPop.toLocaleString(undefined, { maximumFractionDigits: 0 });

  document.getElementById('stat-pop-rural').textContent =
    ruralPop.toLocaleString(undefined, { maximumFractionDigits: 0 });

  document.getElementById('stat-pop-total').textContent =
    (urbanPop + ruralPop).toLocaleString(undefined, { maximumFractionDigits: 0 });

  // document.getElementById('stat-built-share').textContent =
  //   `${meanBuiltShare.toFixed(1)}%`;
  document.getElementById('stat-built-share').textContent =
    `${urbanAreaPct.toFixed(1)}%`;

  runCalculations();
}

// ── OWB CALCULATIONS ──────────────────────────────────────────
function runCalculations() {
  const genU = parseFloat(document.getElementById('gen-urban').value) || 0;
  const genR = parseFloat(document.getElementById('gen-rural').value) || 0;
  
  const pickU = (parseFloat(document.getElementById('pickup-urban').value) || 0) / 100;
  const pickR = (parseFloat(document.getElementById('pickup-rural').value) || 0) / 100;
  
  const burnU = (parseFloat(document.getElementById('burn-urban').value) || 0) / 100;
  const burnR = (parseFloat(document.getElementById('burn-rural').value) || 0) / 100;
  
  const landfillCap = parseFloat(document.getElementById('landfill-cap').value) || 0;

  // 1. Calculate Generated (kg -> tons: / 1000)
  const genUrbanTons = (extractedPop.urban * genU) / 1000;
  const genRuralTons = (extractedPop.rural * genR) / 1000;
  const genTotal = genUrbanTons + genRuralTons;

  // 2. Calculate Picked Up
  let pickUrbanTons = genUrbanTons * pickU;
  let pickRuralTons = genRuralTons * pickR;
  let pickTotal = pickUrbanTons + pickRuralTons;

  // 3. Landfill Capacity Constraint Check
  const pickupContainer = document.getElementById('pickup-container');
  const warningText = document.getElementById('landfill-warning');
  
  pickupContainer.classList.remove('flash-red');
  warningText.classList.add('hidden');

  if (landfillCap === 0 && pickTotal > 0) {
    pickupContainer.classList.add('flash-red');
    warningText.textContent = "Warning: No landfill size selected (capacity = 0). Waste picked up is not managed! Discounted to 0 tons.";
    warningText.classList.remove('hidden');
    pickUrbanTons = 0;
    pickRuralTons = 0;
    pickTotal = 0;
  } else if (pickTotal > landfillCap && landfillCap > 0) {
    pickupContainer.classList.add('flash-red');
    warningText.textContent = `Warning: Picked up waste (${pickTotal.toFixed(1)} t/day) exceeds landfill capacity (${landfillCap} t/day). Discounting managed waste to capacity.`;
    warningText.classList.remove('hidden');
    
    const ratio = landfillCap / pickTotal;
    pickUrbanTons *= ratio;
    pickRuralTons *= ratio;
    pickTotal = landfillCap;
  }

  // 4. Calculate OWB
  const owbUrban = (genUrbanTons - pickUrbanTons) * burnU;
  const owbRural = (genRuralTons - pickRuralTons) * burnR;
  const owbDailyTotal = owbUrban + owbRural;
  const owbYearlyTotal = owbDailyTotal * 365;

  // 5. Update UI
  document.getElementById('res-gen-urban').textContent = genUrbanTons.toLocaleString(undefined, { maximumFractionDigits: 0 });
  document.getElementById('res-gen-rural').textContent = genRuralTons.toLocaleString(undefined, { maximumFractionDigits: 0 });
  document.getElementById('res-gen-total').textContent = genTotal.toLocaleString(undefined, { maximumFractionDigits: 0 });

  document.getElementById('res-pickup-urban').textContent = pickUrbanTons.toLocaleString(undefined, { maximumFractionDigits: 2 });
  document.getElementById('res-pickup-rural').textContent = pickRuralTons.toLocaleString(undefined, { maximumFractionDigits: 2 });
  document.getElementById('res-pickup-total').textContent = pickTotal.toLocaleString(undefined, { maximumFractionDigits: 2 });

  document.getElementById('res-owb-urban').textContent = owbUrban.toLocaleString(undefined, { maximumFractionDigits: 0 });
  document.getElementById('res-owb-rural').textContent = owbRural.toLocaleString(undefined, { maximumFractionDigits: 0 });
  document.getElementById('res-owb-daily').textContent = owbDailyTotal.toLocaleString(undefined, { maximumFractionDigits: 0 });
  document.getElementById('res-owb-yearly').textContent = owbYearlyTotal.toLocaleString(undefined, { maximumFractionDigits: 0});
}

// ── BIND INPUT LISTENERS ──────────────────────────────────────
const inputIds = [
  'gen-urban', 'gen-rural', 'pickup-urban', 'pickup-rural', 
  'burn-urban', 'burn-rural', 'landfill-cap'
];

inputIds.forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', runCalculations);
});

// ── INIT APPLICATION ─────────────────────────────────────────
async function init() {
  const btnPop = document.getElementById('btn-population');
  const btnBuilt = document.getElementById('btn-builtarea');

  try {
    rawTifInfo.population = await loadTifData(CONFIG.populationTifPath);
    layers.population = createRasterLayer(rawTifInfo.population, getPopulationColor);
    btnPop.textContent = 'Toggle Population';
    btnPop.disabled = false;
  } catch (err) {
    btnPop.textContent = 'Pop Error (Check Path)';
    console.error('Failed to load Population TIF:', err);
  }

  try {
    rawTifInfo.builtArea = await loadTifData(CONFIG.builtAreaTifPath);
    layers.builtArea = createRasterLayer(rawTifInfo.builtArea, getBuiltAreaColor);
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

  if (rawTifInfo.population && rawTifInfo.builtArea) {
    extractPopulationsInBounds(null);
  }
}
// ============================================================================
// GRID DATA ENGINE (CSV EXPORT & HEATMAP OVERLAY)
// ============================================================================

// 1. Create a dedicated Map Layer for the Heatmap
const heatmapLayer = L.featureGroup().addTo(map);

// 2. Reusable download helper
if (typeof window.downloadBlob === 'undefined') {
  window.downloadBlob = function(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
}

// 3. Generate Blank Grid Coordinates
function computeGrid01(bbox) {
  const res = 0.01;
  const ncols = Math.round((bbox.neLng - bbox.swLng) / res);
  const nrows = Math.round((bbox.neLat - bbox.swLat) / res);
  const cells = [];
  
  for (let row = 0; row < nrows; row++){
    const cellSwLat = bbox.swLat + row * res;
    const cellNeLat = bbox.swLat + (row + 1) * res; 
    for (let col = 0; col < ncols; col++){
      const cellSwLng = bbox.swLng + col * res;
      const cellNeLng = bbox.swLng + (col + 1) * res; 
      
      cells.push({
        ncol: col + 1, nrow: row + 1,
        sw_long: cellSwLng, sw_lat: cellSwLat,
        ne_long: cellNeLng, ne_lat: cellNeLat,
        center_long: (cellSwLng + cellNeLng) / 2, 
        center_lat: (cellSwLat + cellNeLat) / 2
      });
    }
  }
  return cells;
}

// 4. Helper to get raw Population & Built Share for a single 0.01 cell
function getCellStats(c) {
  if (!rawTifInfo.population || !rawTifInfo.builtArea) return { urbanPop: 0, ruralPop: 0, totalPop: 0, meanBuiltShare: 0 };
  const popInfo = rawTifInfo.population; const builtInfo = rawTifInfo.builtArea;
  const colMin = Math.max(0, Math.ceil((c.sw_long - popInfo.originX) / popInfo.pixelW - 0.5));
  const colMax = Math.min(popInfo.width - 1, Math.floor((c.ne_long - popInfo.originX) / popInfo.pixelW - 0.5));
  const rowMin = Math.max(0, Math.ceil((popInfo.originY - c.ne_lat) / popInfo.pixelH - 0.5));
  const rowMax = Math.min(popInfo.height - 1, Math.floor((popInfo.originY - c.sw_lat) / popInfo.pixelH - 0.5));

  let urbanPop = 0, ruralPop = 0, totalBuiltPctSum = 0, validBuiltPixelCount = 0;
  if (colMin > colMax || rowMin > rowMax) return { urbanPop: 0, ruralPop: 0, totalPop: 0, meanBuiltShare: 0 };

  for (let r = rowMin; r <= rowMax; r++) {
    const y = popInfo.originY - (r + 0.5) * popInfo.pixelH;
    for (let col = colMin; col <= colMax; col++) {
      const x = popInfo.originX + (col + 0.5) * popInfo.pixelW;
      const popVal = popInfo.data[r * popInfo.width + col];

      if (popVal !== null && popVal !== undefined && Number.isFinite(Number(popVal)) && popVal !== popInfo.nodata && popVal > 0) {
        const builtCol = Math.floor((x - builtInfo.originX) / builtInfo.pixelW);
        const builtRow = Math.floor((builtInfo.originY - y) / builtInfo.pixelH);
        
        if (builtCol >= 0 && builtCol < builtInfo.width && builtRow >= 0 && builtRow < builtInfo.height) {
          const builtVal = builtInfo.data[builtRow * builtInfo.width + builtCol];
          const builtPctRaw = Number(builtVal);
          if (
            builtVal !== null &&
            builtVal !== undefined &&
            Number.isFinite(builtPctRaw) &&
            builtVal !== builtInfo.nodata &&
            builtPctRaw >= 0 &&
            builtPctRaw <= 100
          ) {
            const builtPct = builtPctRaw;
            totalBuiltPctSum += builtPct;
            validBuiltPixelCount++;
            (builtPct >= 20) ? (urbanPop += Number(popVal)) : (ruralPop += Number(popVal));
          }
        }
      }
    }
  }
  return { urbanPop, ruralPop, totalPop: urbanPop + ruralPop, meanBuiltShare: validBuiltPixelCount > 0 ? totalBuiltPctSum / validBuiltPixelCount : 0 };
}

// 5. Shared Function: Calculate full grid data (Used by both CSV and Heatmap)
function calculateGridData(activeBbox) {
    const cells = computeGrid01(activeBbox);
    const genU = parseFloat(document.getElementById('gen-urban')?.value) || 0;
    const pickU = (parseFloat(document.getElementById('pickup-urban')?.value) || 0) / 100;
    const burnU = (parseFloat(document.getElementById('burn-urban')?.value) || 0) / 100;
    const genR = parseFloat(document.getElementById('gen-rural')?.value) || 0;
    const pickR = (parseFloat(document.getElementById('pickup-rural')?.value) || 0) / 100;
    const burnR = (parseFloat(document.getElementById('burn-rural')?.value) || 0) / 100;
    const landfillCap = parseFloat(document.getElementById('landfill-cap')?.value) || 0;

    // Pass 1: compute raw generated/picked-up per cell so we know the
    // AOI-wide picked-up total, needed to size the capacity discount ratio.
    const rawCells = [];
    let pickTotalRawKg = 0;
    for (const c of cells) {
        const stats = getCellStats(c);
        if (stats.totalPop === 0) continue; // Skip empty cells (deserts, oceans)

        const wasteGenU = stats.urbanPop * genU;
        const wasteGenR = stats.ruralPop * genR;
        const pickUKg = wasteGenU * pickU;
        const pickRKg = wasteGenR * pickR;

        pickTotalRawKg += pickUKg + pickRKg;
        rawCells.push({ c, stats, wasteGenU, wasteGenR, pickUKg, pickRKg });
    }

    // Same capacity-constraint logic as runCalculations(), applied as a
    // single AOI-wide ratio so per-cell numbers stay consistent with the
    // panel totals: no landfill selected -> nothing is landfilled (all
    // picked-up waste is treated as uncollected); over capacity -> scale
    // down the picked-up amount proportionally.
    const pickTotalRawTons = pickTotalRawKg / 1000;
    let capRatio = 1;
    if (landfillCap === 0 && pickTotalRawTons > 0) {
        capRatio = 0;
    } else if (pickTotalRawTons > landfillCap && landfillCap > 0) {
        capRatio = landfillCap / pickTotalRawTons;
    }

    // Pass 2: apply the ratio and compute what's actually burnt per cell.
    const dataArray = [];
    for (const { c, stats, wasteGenU, wasteGenR, pickUKg, pickRKg } of rawCells) {
        const effPickUKg = pickUKg * capRatio;
        const effPickRKg = pickRKg * capRatio;
        let uncollectedU = wasteGenU - effPickUKg;
        let uncollectedR = wasteGenR - effPickRKg;
        let burntUKg = uncollectedU * burnU;
        let burntRKg = uncollectedR * burnR;
        let totalBurntKg = burntUKg + burntRKg;

        dataArray.push({
            c, stats, 
            totalGenKg: wasteGenU + wasteGenR, 
            totalBurntKg: totalBurntKg, 
            owbTons: totalBurntKg / 1000
        });
    }
    return dataArray;
}

// ============================================================================
// EVENT LISTENERS: CSV AND HEATMAP
// ============================================================================

const downloadGridCsvBtn = document.getElementById('download-grid-csv');
const btnShowHeatmap = document.getElementById('btn-show-heatmap');
const btnClearHeatmap = document.getElementById('btn-clear-heatmap');

// Helper to get bounding box
function getActiveBbox() {
    if (!activeBounds) return null;
    return { swLng: activeBounds.getWest(), swLat: activeBounds.getSouth(), neLng: activeBounds.getEast(), neLat: activeBounds.getNorth() };
}

// --- CSV EXPORT ACTION ---
if (downloadGridCsvBtn) {
  downloadGridCsvBtn.addEventListener('click', function() {
    const activeBbox = getActiveBbox();
    if (!activeBbox) return alert("Please draw a bounding box first.");

    downloadGridCsvBtn.textContent = "Calculating..."; downloadGridCsvBtn.disabled = true;

    setTimeout(() => {
      const gridData = calculateGridData(activeBbox);
      let csvContent = "ncol,nrow,center_long,center_lat,total_population,urban_population,rural_population,mean_built_share_pct,waste_gen_kg_day,waste_burnt_kg_day,owb_emissions_tons_day\n";
      
      gridData.forEach(d => {
        csvContent += `${d.c.ncol},${d.c.nrow},${d.c.center_long.toFixed(4)},${d.c.center_lat.toFixed(4)},${d.stats.totalPop.toFixed(2)},${d.stats.urbanPop.toFixed(2)},${d.stats.ruralPop.toFixed(2)},${d.stats.meanBuiltShare.toFixed(2)},${d.totalGenKg.toFixed(2)},${d.totalBurntKg.toFixed(2)},${d.owbTons.toFixed(4)}\n`;
      });

      window.downloadBlob(csvContent, 'owb_grid_emissions.csv', 'text/csv');
      downloadGridCsvBtn.textContent = "↓ Download 0.01° Grid CSV"; downloadGridCsvBtn.disabled = false;
    }, 50);
  });
}

// --- HEATMAP LEGEND CONTROL ---
const heatmapLegend = L.control({ position: 'bottomleft' });

heatmapLegend.onAdd = function () {
    const div = L.DomUtil.create('div', 'info legend');
    div.id = 'heatmap-legend';
    div.style.background = 'white';
    div.style.padding = '10px 14px';
    div.style.borderRadius = '8px';
    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    div.style.fontFamily = 'inherit';
    div.style.fontSize = '0.8rem';
    div.style.lineHeight = '1.4';
    div.style.color = '#1a1e18';
    return div;
};

// --- HEATMAP GENERATOR ACTION ---
// Define Color Scale (Yellow to Red based on max value)
function getHeatmapColor(val, maxVal) {
    if (maxVal === 0 || val === 0) return 'transparent'; 
    const ratio = val / maxVal;
    if (ratio > 0.8) return '#bd0026'; // Dark Red
    if (ratio > 0.6) return '#f03b20'; // Red
    if (ratio > 0.4) return '#fd8d3c'; // Orange
    if (ratio > 0.2) return '#fecc5c'; // Yellow-Orange
    return '#ffffb2';                  // Yellow
}

if (btnShowHeatmap) {
    btnShowHeatmap.addEventListener('click', function() {
        const activeBbox = getActiveBbox();
        if (!activeBbox) return alert("Please draw a bounding box first.");

        btnShowHeatmap.textContent = "Rendering..."; btnShowHeatmap.disabled = true;

        setTimeout(() => {
            heatmapLayer.clearLayers();
            const gridData = calculateGridData(activeBbox);

            if (gridData.length === 0) {
                alert("No population data found in this area.");
                btnShowHeatmap.textContent = "🔥 Show Waste Burnt Heatmap (0.01°)"; btnShowHeatmap.disabled = false;
                return;
            }

            // Find the maximum burnt kg to scale our colors dynamically
            const maxBurnt = Math.max(...gridData.map(d => d.totalBurntKg));

            // Render rectangles onto the map
            gridData.forEach(d => {
                if (d.totalBurntKg === 0) return; 
                
                const bounds = [[d.c.sw_lat, d.c.sw_long], [d.c.ne_lat, d.c.ne_long]];
                const color = getHeatmapColor(d.totalBurntKg, maxBurnt);

                const rect = L.rectangle(bounds, {
                    color: '#000000', // Black border color
                    weight: 0.5,      // Thin border width
                    fillColor: color, // Heatmap color for the inside
                    fillOpacity: 0.6  // Semi-transparent fill
                });
                
                rect.bindTooltip(`
                    <div style="text-align:center;">
                        <b>🔥 Waste Burnt:</b> ${d.totalBurntKg.toFixed(1)} kg/day<br>
                        <b>👥 Population:</b> ${d.stats.totalPop.toFixed(0)}
                    </div>
                `, { direction: 'top', className: 'custom-tooltip' });
                
                heatmapLayer.addLayer(rect);
            });

            // Add dynamic legend to the map
            heatmapLegend.addTo(map);
            const legendDiv = document.getElementById('heatmap-legend');
            if (legendDiv) {
                legendDiv.innerHTML = `
                    <b>🔥 Waste Burnt (kg/day)</b><br>
                    <span style="color:#6b7268; font-size: 0.75rem; margin-bottom: 6px; display: block;">Per 0.01° grid cell</span>
                    <i style="background:#ffffb2; border: 1px solid #000; width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &gt; 0 to ${(maxBurnt * 0.2).toFixed(0)}<br>
                    <i style="background:#fecc5c; border: 1px solid #000; width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &gt; ${(maxBurnt * 0.2).toFixed(0)} to ${(maxBurnt * 0.4).toFixed(0)}<br>
                    <i style="background:#fd8d3c; border: 1px solid #000; width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &gt; ${(maxBurnt * 0.4).toFixed(0)} to ${(maxBurnt * 0.6).toFixed(0)}<br>
                    <i style="background:#f03b20; border: 1px solid #000; width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &gt; ${(maxBurnt * 0.6).toFixed(0)} to ${(maxBurnt * 0.8).toFixed(0)}<br>
                    <i style="background:#bd0026; border: 1px solid #000; width:12px; height:12px; display:inline-block; margin-right:5px;"></i> &gt; ${(maxBurnt * 0.8).toFixed(0)}<br>
                `;
            }

            if (btnClearHeatmap) btnClearHeatmap.classList.remove('hidden');
            btnShowHeatmap.textContent = "🔥 Show Waste Burnt Heatmap (0.01°)"; btnShowHeatmap.disabled = false;
        }, 50);
    });
}

// --- CLEAR HEATMAP ACTION ---
if (btnClearHeatmap) {
    btnClearHeatmap.addEventListener('click', function() {
        heatmapLayer.clearLayers();
        map.removeControl(heatmapLegend); // Hide legend
        btnClearHeatmap.classList.add('hidden');
    });
}

// Auto-clear heatmap & legend when clearing the overall bounding box
document.getElementById('btn-clear-box')?.addEventListener('click', () => {
    heatmapLayer.clearLayers();
    map.removeControl(heatmapLegend); // Hide legend
    if(btnClearHeatmap) btnClearHeatmap.classList.add('hidden');
});
init();