let lastResult = null;

(function(){
  // ---------- ambient dust decoration ----------
  const dustEl = document.getElementById('dust');
  const dustCount = 26;
  for(let i=0;i<dustCount;i++){
    const s = document.createElement('span');
    const left = Math.random()*100;
    const dur = 9 + Math.random()*10;
    const delay = Math.random()*12;
    const size = 2 + Math.random()*2.5;
    s.style.left = left+'%';
    s.style.bottom = (Math.random()*30)+'%';
    s.style.width = size+'px';
    s.style.height = size+'px';
    s.style.animationDuration = dur+'s';
    s.style.animationDelay = delay+'s';
    dustEl.appendChild(s);
  }

  // ---------- state ----------
  let csvRows = null;       
  let sourceNames = [];     
  let sliderValues = {};    
  let fileName = '';

  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const fileChipHolder = document.getElementById('fileChipHolder');
  const csvError = document.getElementById('csvError');
  const totalEmissionsInput = document.getElementById('totalEmissions');
  const sourceSection = document.getElementById('sourceSection');
  const slidersEl = document.getElementById('sliders');
  const sumRow = document.getElementById('sumRow');
  const sumLabel = document.getElementById('sumLabel');
  const balanceBtn = document.getElementById('balanceBtn');
  const generateBtn = document.getElementById('generateBtn');
  const statsEl = document.getElementById('stats');
  const stage = document.getElementById('stage');
  const tooltip = document.getElementById('tooltip');
  const downloadSection = document.getElementById('downloadSection');
  const downloadBtn = document.getElementById('downloadBtn');

  // ---------- CSV upload wiring ----------
  dropzone.addEventListener('click', ()=>fileInput.click());
  dropzone.addEventListener('dragover', e=>{ e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', ()=> dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', e=>{
    e.preventDefault();
    dropzone.classList.remove('drag');
    if(e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e=>{
    if(e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  function handleFile(file){
    fileName = file.name;
    csvError.innerHTML = '';
    const reader = new FileReader();
    reader.onload = evt => {
      try{
        parseCSV(evt.target.result);
        renderFileChip();
        buildSliders();
        checkReady();
      }catch(err){
        csvError.innerHTML = '<div class="error-msg">'+err.message+'</div>';
        csvRows = null;
        sourceSection.style.display = 'none';
        downloadSection.style.display = 'none';
        lastResult = null;
        checkReady();
      }
    };
    reader.readAsText(file);
  }

  function renderFileChip(){
    fileChipHolder.innerHTML = '';
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = '<span>'+fileName+' · '+csvRows.length+' cells</span>';
    const btn = document.createElement('button');
    btn.textContent = 'remove';
    btn.onclick = ()=>{
      csvRows = null; sourceNames = []; fileName='';
      fileChipHolder.innerHTML = '';
      sourceSection.style.display = 'none';
      downloadSection.style.display = 'none';
      lastResult = null;
      checkReady();
    };
    chip.appendChild(btn);
    fileChipHolder.appendChild(chip);
  }

  function parseCSV(text){
    const lines = text.split(/\r?\n/).filter(l => l.trim().length>0);
    if(lines.length < 2) throw new Error('CSV looks empty.');
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const ncolIdx = header.indexOf('ncol');
    const nrowIdx = header.indexOf('nrow');
    if(ncolIdx === -1 || nrowIdx === -1){
      throw new Error('Could not find "ncol" and "nrow" columns in the header.');
    }
    const srcCols = [];
    header.forEach((h, i) => { if(i!==ncolIdx && i!==nrowIdx) srcCols.push({name:h, idx:i}); });
    if(srcCols.length === 0) throw new Error('No source columns found besides ncol / nrow.');

    const rows = [];
    for(let i=1;i<lines.length;i++){
      const parts = lines[i].split(',');
      const ncol = parseFloat(parts[ncolIdx]);
      const nrow = parseFloat(parts[nrowIdx]);
      if(Number.isNaN(ncol) || Number.isNaN(nrow)) continue; 
      const row = { ncol, nrow };
      srcCols.forEach(sc => {
        const v = parseFloat(parts[sc.idx]);
        row[sc.name] = Number.isNaN(v) ? 0 : v;
      });
      rows.push(row);
    }
    if(rows.length === 0) throw new Error('No valid rows found after reading ncol / nrow.');
    csvRows = rows;
    sourceNames = srcCols.map(s=>s.name);
  }

  // ---------- sliders ----------
  function buildSliders(){
    sourceSection.style.display = 'block';
    slidersEl.innerHTML = '';
    const even = Math.round(100/sourceNames.length);
    sliderValues = {};
    sourceNames.forEach((name, i) => {
      sliderValues[name] = even;
    });
    fixRoundingOnLast();
    sourceNames.forEach(name => {
      const row = document.createElement('div');
      row.className = 'slider-row';
      row.innerHTML =
        '<div class="slabel"><span class="name">'+name.replace(/_/g,' ')+'</span><span class="val" id="val-'+cssSafe(name)+'">'+sliderValues[name]+'%</span></div>'+
        '<input type="range" min="0" max="100" step="1" value="'+sliderValues[name]+'" id="slider-'+cssSafe(name)+'">';
      slidersEl.appendChild(row);
      const input = row.querySelector('input');
      input.addEventListener('input', e=>{
        sliderValues[name] = parseInt(e.target.value, 10);
        document.getElementById('val-'+cssSafe(name)).textContent = sliderValues[name]+'%';
        updateSum();
      });
    });
    updateSum();
  }

  function fixRoundingOnLast(){
    const total = sourceNames.reduce((a,n)=>a+sliderValues[n],0);
    const diff = Math.round(100-total);
    if(sourceNames.length){
      const last = sourceNames[sourceNames.length-1];
      sliderValues[last] = Math.max(0, sliderValues[last]+diff);
    }
  }

  function cssSafe(s){ return s.replace(/[^a-z0-9]/gi,'_'); }

  function currentSum(){
    return sourceNames.reduce((a,n)=>a + (sliderValues[n]||0), 0);
  }

  function updateSum(){
    const total = currentSum();
    const ok = total === 100;
    sumLabel.textContent = 'Sum: ' + total + '%' + (ok ? ' ✓' : ' — needs to hit 100%');
    sumRow.classList.toggle('warn', !ok);
    checkReady();
  }

  balanceBtn.addEventListener('click', ()=>{
    const even = Math.round(100/sourceNames.length);
    sourceNames.forEach(n => sliderValues[n] = even);
    fixRoundingOnLast();
    sourceNames.forEach(name=>{
      document.getElementById('slider-'+cssSafe(name)).value = sliderValues[name];
      document.getElementById('val-'+cssSafe(name)).textContent = sliderValues[name]+'%';
    });
    updateSum();
  });

  totalEmissionsInput.addEventListener('input', checkReady);

  function checkReady(){
    const hasCsv = !!csvRows;
    const totalOk = totalEmissionsInput.value !== '' && parseFloat(totalEmissionsInput.value) > 0;
    const sumOk = sourceNames.length>0 && currentSum() === 100;
    generateBtn.disabled = !(hasCsv && totalOk && sumOk);
  }

  // ---------- compute + render ----------
  generateBtn.addEventListener('click', () => {
    try{
      const result = computeGrid();
      lastResult = result;
      renderHeatmap(result);
      renderStats(result);
      downloadSection.style.display = 'block';
    }catch(err){
      csvError.innerHTML = '<div class="error-msg">'+err.message+'</div>';
      downloadSection.style.display = 'none';
    }
  });

  downloadBtn.addEventListener('click', downloadCSV);

  function downloadCSV(){
    if(!lastResult || !csvRows) return;

    const header = ['ncol', 'nrow', ...sourceNames, 'emission'];
    const lines = [header.join(',')];

    csvRows.forEach(r => {
      const key = Math.round(r.ncol)+'_'+Math.round(r.nrow);
      const emission = lastResult.emissionByKey.get(key);
      const emissionStr = emission === undefined ? '' : emission;
      const rowVals = [r.ncol, r.nrow, ...sourceNames.map(n => r[n]), emissionStr];
      lines.push(rowVals.join(','));
    });

    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = fileName ? fileName.replace(/\.csv$/i, '') : 'grid';
    a.download = baseName + '_with_emissions.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function computeGrid(){
    const totalEmissions = parseFloat(totalEmissionsInput.value);
    const contributions = {};
    sourceNames.forEach(n => contributions[n] = sliderValues[n]/100);

    const sums = {};
    sourceNames.forEach(n => sums[n] = 0);
    csvRows.forEach(r => sourceNames.forEach(n => sums[n]+=r[n]));

    let ncolMax=0, nrowMax=0;
    csvRows.forEach(r=>{ if(r.ncol>ncolMax) ncolMax=r.ncol; if(r.nrow>nrowMax) nrowMax=r.nrow; });
    ncolMax = Math.round(ncolMax); nrowMax = Math.round(nrowMax);

    const map = new Map();
    const emissionByKey = new Map();
    csvRows.forEach(r=>{
      let emission = 0;
      const norm = {};
      sourceNames.forEach(n=>{
        const nv = sums[n] > 0 ? r[n]/sums[n] : 0;
        norm[n] = nv;
        emission += nv * contributions[n];
      });
      emission *= totalEmissions;
      const key = Math.round(r.ncol)+'_'+Math.round(r.nrow);
      map.set(key, { emission, norm, raw:r });
      emissionByKey.set(key, emission);
    });

    // Reordered mapping: 
    // y-axis (rows in DOM) maps to nrow, x-axis (cols in DOM) maps to ncol.
    // Rows iterate down from nrowMax to 1 (top to bottom), columns iterate
    // up from 1 to ncolMax (left to right), so bottom-left is (ncol=1,
    // nrow=1) and top-right is (ncol=ncolMax, nrow=nrowMax).
    const grid = [];
    let min = Infinity, max = -Infinity, sumEm=0, filled=0;
    let maxCell = null;
    
    for(let i=0;i<nrowMax;i++){
      const rowArr = [];
      const nrow = nrowMax - i;
      for(let j=0;j<ncolMax;j++){
        const ncol = j + 1;
        const cell = map.get(ncol+'_'+nrow);
        const emission = cell ? cell.emission : null;
        if(emission !== null){
          if(emission < min) min = emission;
          if(emission > max){ max = emission; maxCell = {ncol,nrow,emission}; }
          sumEm += emission;
          filled++;
        }
        rowArr.push({ ncol, nrow, emission, norm: cell ? cell.norm : null, raw: cell ? cell.raw : null });
      }
      grid.push(rowArr);
    }
    
    if(min===Infinity){ min=0; max=0; }
    return { grid, ncolMax, nrowMax, min, max, sumEm, filled, totalEmissions, maxCell, contributions, emissionByKey };
  }

const RAMP = [
  [0.00, [0x13, 0x2B, 0x12]], // Low emissions (Dark Green)
  [0.20, [0x2E, 0x6F, 0x28]], // Low-Mid (Green)
  [0.40, [0x6D, 0xB3, 0x3F]], // Mid (Yellow-Green)
  [0.60, [0xE5, 0xC1, 0x38]], // Mid-High (Yellow)
  [0.80, [0xE6, 0x7E, 0x22]], // High (Orange)
  [1.00, [0xD9, 0x38, 0x29]]  // Peak emissions (Red)
];

  function rampColor(t){
    t = Math.max(0, Math.min(1, t));
    for(let i=0;i<RAMP.length-1;i++){
      const [t0,c0] = RAMP[i], [t1,c1] = RAMP[i+1];
      if(t>=t0 && t<=t1){
        const f = t1===t0 ? 0 : (t-t0)/(t1-t0);
        const r = Math.round(c0[0]+(c1[0]-c0[0])*f);
        const g = Math.round(c0[1]+(c1[1]-c0[1])*f);
        const b = Math.round(c0[2]+(c1[2]-c0[2])*f);
        return 'rgb('+r+','+g+','+b+')';
      }
    }
    return 'rgb(20,19,17)';
  }

  let cellDataFlat = [];

  function renderHeatmap(result){
    const { grid, ncolMax, nrowMax, min, max } = result;
    const isMobile = window.innerWidth <= 900;
    const stageRect = stage.getBoundingClientRect();
    // Reserve pixels for Y/X axis labels and legend bar (mobile has tighter
    // stage padding and a smaller legend, so it needs less headroom reserved)
    const reservedWidth = isMobile ? 48 : 64;
    const reservedHeight = isMobile ? 74 : 110;
    const availW = Math.max(50, stageRect.width - reservedWidth - 4);
    const availH = Math.max(50, stageRect.height - reservedHeight - 4); 

    cellDataFlat = [];

    const wrap = document.createElement('div');
    wrap.className = 'heatmap-wrap';
    
    // Axis container layout
    const axisContainer = document.createElement('div');
    axisContainer.style.display = 'grid';
    axisContainer.style.gridTemplateColumns = 'auto 1fr';
    axisContainer.style.gridTemplateRows = '1fr auto';
    axisContainer.style.gap = '8px';
    axisContainer.style.alignItems = 'stretch';
    
    // Y-Axis
    const yAxis = document.createElement('div');
    yAxis.className = 'axis-y';
    yAxis.innerHTML = '<span>'+nrowMax+'</span><span style="writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: 1px;">nrow</span><span>1</span>';
    
    // X-Axis
    const xAxis = document.createElement('div');
    xAxis.className = 'axis-x';
    xAxis.innerHTML = '<span>1</span><span style="letter-spacing: 1px;">ncol</span><span>'+ncolMax+'</span>';

    const frame = document.createElement('div');
    frame.className = 'grid-frame';
    const gridEl = document.createElement('div');
    gridEl.id = 'gridCanvasWrap';

    // .grid-frame adds 14px padding + 1px border on each side; #gridCanvasWrap
    // adds a 1px gap between every cell. Both must be subtracted before we
    // divide up the space, or the rendered grid overflows the stage and gets
    // clipped by .visual's overflow:hidden (edges/legend disappear).
    const FRAME_CHROME = 30; // (14px padding + 1px border) * 2 sides
    const CELL_GAP = 1;
    const gridAvailW = Math.max(20, availW - FRAME_CHROME);
    const gridAvailH = Math.max(20, availH - FRAME_CHROME);
    const cellW = (gridAvailW - CELL_GAP * (ncolMax - 1)) / ncolMax;
    const cellH = (gridAvailH - CELL_GAP * (nrowMax - 1)) / nrowMax;
    const cellPx = Math.max(isMobile ? 2 : 3, Math.floor(Math.min(cellW, cellH)));
    gridEl.style.gridTemplateColumns = 'repeat('+ncolMax+', '+cellPx+'px)';
    gridEl.style.gridTemplateRows = 'repeat('+nrowMax+', '+cellPx+'px)';
    let idx = 0;
    for(let i=0;i<nrowMax;i++){
      for(let j=0;j<ncolMax;j++){
        const c = grid[i][j];
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.idx = idx;
        const t = (c.emission===null || max===min) ? 0 : Math.sqrt((c.emission-min)/(max-min));
        div.style.background = c.emission===null ? 'rgba(255,255,255,0.03)' : rampColor(t);
        const delay = (i+j) * 0.55;
        div.style.animationDelay = Math.min(delay, 90)+'ms';
        gridEl.appendChild(div);
        cellDataFlat.push(c);
        idx++;
      }
    }
    
    // Assemble layout
    frame.appendChild(gridEl);
    axisContainer.appendChild(yAxis);
    axisContainer.appendChild(frame);
    axisContainer.appendChild(xAxis);
    wrap.appendChild(axisContainer);

    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML =
      '<div class="legend-bar"></div>'+
      '<div class="legend-labels"><span>'+fmt(Math.round((min)))+'</span><span>'+fmt(Math.round((min + max) / 2))+'</span><span>'+fmt(Math.round((max)))+'</span></div>'+
      '<div class="legend-cap">emissions per cell — colour scaled √ for visibility</div>';
    wrap.appendChild(legend);

    stage.innerHTML = '';
    stage.appendChild(wrap);

    gridEl.addEventListener('mousemove', onCellHover);
    gridEl.addEventListener('mouseleave', ()=> hideTooltip());
  }

  function onCellHover(e){
    const target = e.target.closest('.cell');
    if(!target){ hideTooltip(); return; }
    const idx = parseInt(target.dataset.idx, 10);
    const c = cellDataFlat[idx];
    if(!c){ hideTooltip(); return; }
    showTooltip(e, c);
  }

  function showTooltip(e, c){
    let html = '<div class="tt-head"><span>ncol '+c.ncol+' · nrow '+c.nrow+'</span></div>';
    if(c.emission === null){
      html += '<div class="tt-row">no data for this cell</div>';
    }else{
      html += '<div class="tt-row"><span>emission</span><b>'+fmt(c.emission)+'</b></div>';
      if(c.norm && c.raw){
        html += '<div class="tt-divider"></div>';
        sourceNames.forEach(n=>{
          const share = c.norm[n]||0;
          const pct = Math.round(share*1000)/10;
          const rawVal = c.raw[n];
          // Adding clarity label for Raw source amount mapping
          html += '<div class="tt-src-row">'+
                    '<span class="tt-src-name" style="text-transform:capitalize;">'+n.replace(/_/g,' ')+'</span>'+
                    '<span class="tt-src-raw">Source amount: '+fmt(rawVal)+'</span>'+
                  '</div>'+
                  '<div class="tt-src"><span class="tt-bar-track"><span class="tt-bar-fill" style="width:'+Math.min(100,pct*6)+'%"></span></span></div>';
        });
      }
    }
    tooltip.innerHTML = html;
    tooltip.classList.add('show');
    const x = e.clientX + 16;
    const y = e.clientY + 16;
    const maxX = window.innerWidth - 220;
    const maxY = window.innerHeight - 160;
    tooltip.style.transform = 'translate('+Math.min(x,maxX)+'px,'+Math.min(y,maxY)+'px)';
  }
  
  function hideTooltip(){ tooltip.classList.remove('show'); tooltip.style.transform='translate(-9999px,-9999px)'; }

  function fmt(v){
    if(v===null || v===undefined) return '—';
    if(Math.abs(v) >= 1000) return v.toLocaleString(undefined,{maximumFractionDigits:0});
    if(Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  function renderStats(result){
    const { min, max, sumEm, filled, maxCell, ncolMax, nrowMax } = result;
    statsEl.style.display = 'grid';
    statsEl.innerHTML =
      stat('Grid size', ncolMax+' × '+nrowMax) +
      stat('Cells with data', filled.toLocaleString()) +
      stat('Distributed total', fmt(sumEm)) +
      stat('Peak cell', maxCell ? ('ncol '+maxCell.ncol+', nrow '+maxCell.nrow) : '—');
  }
  
  function stat(k,v){
    return '<div class="stat"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>';
  }
})();