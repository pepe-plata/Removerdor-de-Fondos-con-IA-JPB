// ===================================================================
//  Removedor de Fondos con IA JPB — PWA (v13)
//  Incluye optimizaciones GPU condicionales para Android
// ===================================================================

(() => {
  'use strict';

  // ===================================================================
  //  DETECCIÓN DE ENTORNO
  // ===================================================================
  const IS_ANDROID = /Android/i.test(navigator.userAgent) ||
                     (window.__JPB_IS_ANDROID__ === true);
  const IS_MOBILE_VIEWPORT = window.matchMedia('(max-width: 720px)').matches;
  const IS_LOW_GPU = IS_ANDROID;   // aplicar optimizaciones GPU solo en Android

  // Umbral para overlay reducido: imágenes > 4 megapíxeles
  const LARGE_IMAGE_PIXELS = 4 * 1000 * 1000;

  // Escala del overlay cuando la imagen es grande (0.5 = mitad)
  const OVERLAY_SCALE_LOW = 0.5;

  // Umbral de blur en Android para no reventar la GPU
  const MAX_BLUR_LOW = 30;

  console.log('[env] Android:', IS_ANDROID, '| LowGPU:', IS_LOW_GPU);

  // ===================================================================
  //  SPLASH
  // ===================================================================
  const splashEl = document.getElementById('splash');
  if (splashEl) {
    const SPLASH_DURATION = 2000;
    const shownAt = Date.now();
    window.addEventListener('load', () => {
      const elapsed = Date.now() - shownAt;
      const remaining = Math.max(0, SPLASH_DURATION - elapsed);
      setTimeout(() => {
        splashEl.classList.add('hide');
        setTimeout(() => { splashEl.style.display = 'none'; }, 450);
      }, remaining);
    });
    setTimeout(() => {
      if (!splashEl.classList.contains('hide')) {
        splashEl.classList.add('hide');
        setTimeout(() => { splashEl.style.display = 'none'; }, 450);
      }
    }, 3200);
  }

  // ===================================================================
  //  ESTADO
  // ===================================================================
  const state = {
    originalImage: null,
    originalFileName: 'imagen',
    originalCanvas: null,
    currentCanvas: null,
    maskCanvas: null,
    displayOriginal: false,
    maskEditorActive: false,
    hasProcessed: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    brushSize: 15,
    brushMode: 'add',
    activeTool: 'brush',
    smartSelect: false,
    targetColor: { r: 255, g: 255, b: 255 },
    colorPickMode: false,
    isPanning: false,
    isDrawing: false,
    lastPointer: { x: 0, y: 0 },
    lastBrushPoint: null,
    spacePressed: false,
    maskBackup: null,
    copyExif: false,

    shapeStart: null,
    shapeCurrent: null,
    lassoPoints: [],
    isDrawingShape: false,

    activePointers: new Map(),
    pinchStart: null,

    pendingStroke: null,
    pendingStrokeDelay: 90,

    history: [],
    historyIndex: -1,
    historyMax: 30,
    isPerformingUndoRedo: false,

    fill: { enabled: false, color: '#ffffff', opacity: 100 },
    blur: { enabled: false, amount: 15, darken: 0 },

    // Overlay reducido en Android con imágenes grandes
    overlayScale: 1,

    bgConfig: {
      light: { mode: 'checker', color: '#eef0f5' },
      dark:  { mode: 'checker', color: '#252938' }
    }
  };

  const MODEL_SOURCES = {
    'u2net': [
      'https://huggingface.co/tomjackson2023/rembg/resolve/main/u2net.onnx',
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx'
    ],
    'u2netp': [
      'https://huggingface.co/tomjackson2023/rembg/resolve/main/u2netp.onnx',
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx'
    ],
    'u2net_human_seg': [
      'https://huggingface.co/tomjackson2023/rembg/resolve/main/u2net_human_seg.onnx',
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx'
    ],
    'isnet-general-use': [
      'https://huggingface.co/tomjackson2023/rembg/resolve/main/isnet-general-use.onnx',
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
    ],
    'silueta': [
      'https://huggingface.co/tomjackson2023/rembg/resolve/main/silueta.onnx',
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx'
    ]
  };

  // ===================================================================
  //  DOM
  // ===================================================================
  const $ = (id) => document.getElementById(id);
  const els = {
    fileName: $('fileName'),
    themeSwitch: $('themeSwitch'),
    btnMenu: $('btnMenu'),
    btnCloseSidebar: $('btnCloseSidebar'),
    sidebar: $('sidebar'),
    sidebarOverlay: $('sidebarOverlay'),
    appMain: document.querySelector('.app-main'),
    btnHelp: $('btnHelp'),
    btnUndo: $('btnUndo'),
    btnRedo: $('btnRedo'),
    btnZoomFit: $('btnZoomFit'),
    btnToggleView: $('btnToggleView'),
    btnCopy: $('btnCopy'),
    btnSave: $('btnSave'),
    btnOpen: $('btnOpen'),
    fileInput: $('fileInput'),
    modelSelect: $('modelSelect'),
    btnProcess: $('btnProcess'),
    processStatus: $('processStatus'),
    btnManageModels: $('btnManageModels'),
    maskEditorToggle: $('maskEditorToggle'),
    maskEditorBody: $('maskEditorBody'),
    toolGroup: $('toolGroup'),
    brushSizeField: $('brushSizeField'),
    brushSize: $('brushSize'),
    brushSizeVal: $('brushSizeVal'),
    brushModeGroup: $('brushModeGroup'),
    smartOpts: $('smartOpts'),
    smartColor: $('smartColor'),
    smartColorVal: $('smartColorVal'),
    smartEdge: $('smartEdge'),
    smartEdgeVal: $('smartEdgeVal'),
    shapeOpts: $('shapeOpts'),
    shapeHint: $('shapeHint'),
    btnCancelMask: $('btnCancelMask'),
    btnApplyMask: $('btnApplyMask'),
    targetColor: $('targetColor'),
    targetColorHex: $('targetColorHex'),
    btnPickColor: $('btnPickColor'),
    tolerance: $('tolerance'),
    toleranceVal: $('toleranceVal'),
    edge: $('edge'),
    edgeVal: $('edgeVal'),
    smooth: $('smooth'),
    smoothVal: $('smoothVal'),
    btnApplyColor: $('btnApplyColor'),
    fillEnabled: $('fillEnabled'),
    fillColor: $('fillColor'),
    fillColorHex: $('fillColorHex'),
    btnFillPickColor: $('btnFillPickColor'),
    fillOpacity: $('fillOpacity'),
    fillOpacityVal: $('fillOpacityVal'),
    btnApplyFill: $('btnApplyFill'),
    btnClearFill: $('btnClearFill'),
    blurEnabled: $('blurEnabled'),
    blurAmount: $('blurAmount'),
    blurAmountVal: $('blurAmountVal'),
    blurDark: $('blurDark'),
    blurDarkVal: $('blurDarkVal'),
    btnApplyBlur: $('btnApplyBlur'),
    btnClearBlur: $('btnClearBlur'),
    btnReset: $('btnReset'),
    canvasArea: $('canvasArea'),
    canvasViewport: $('canvasViewport'),
    canvasInner: $('canvasInner'),
    mainCanvas: $('mainCanvas'),
    overlayCanvas: $('overlayCanvas'),
    emptyState: $('emptyState'),
    brushCursor: $('brushCursor'),
    dims: $('dims'),
    zoomVal: $('zoomVal'),
    statusMsg: $('statusMsg'),
    jpgModal: $('jpgModal'),
    jpgQuality: $('jpgQuality'),
    jpgQualityVal: $('jpgQualityVal'),
    jpgCancel: $('jpgCancel'),
    jpgConfirm: $('jpgConfirm'),
    chkExif: $('chkExif'),
    modelsModal: $('modelsModal'),
    modelsList: $('modelsList'),
    modelsStorage: $('modelsStorage'),
    modelsClose: $('modelsClose'),
    progressModal: $('progressModal'),
    progressTitle: $('progressTitle'),
    progressBar: $('progressBar'),
    progressPercent: $('progressPercent'),
    progressCancel: $('progressCancel'),
    helpModal: $('helpModal'),
    helpClose: $('helpClose'),
    bgModeChecker: $('bgModeChecker'),
    bgModeSolid: $('bgModeSolid'),
    bgSolidField: $('bgSolidField'),
    bgSolidColor: $('bgSolidColor'),
    bgSolidHex: $('bgSolidHex'),
    btnBgApplyLight: $('btnBgApplyLight'),
    btnBgApplyDark: $('btnBgApplyDark')
  };

  const ctx = els.mainCanvas.getContext('2d');
  const overlayCtx = els.overlayCanvas.getContext('2d');

  let originalFileBuffer = null;
  let wakeLock = null;

  // ===================================================================
  //  HELPERS
  // ===================================================================
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const createCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };
  const setStatus = (msg) => { els.statusMsg.textContent = msg; };
  const formatBytes = (b) => {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };
  const hexToRgb = (hex) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  };

  function looksLikeId(name) {
    if (!name) return true;
    const base = name.replace(/\.[^.\/\\]+$/, '');
    if (/^\d{10,}$/.test(base)) return true;
    if (/^[0-9a-f]{8,}$/i.test(base) && /[a-f]/i.test(base)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return true;
    if (/^(IMG|PXL|VID|MVIMG|Screenshot)_?\d{8,}/i.test(base) && base.length > 20) {
      if (!/[0-9a-f]{6,}$/i.test(base)) return false;
    }
    if (/^(image_picker|file_picker|content-uri|media)[\s_-]?/i.test(base)) return true;
    const digits = (base.match(/\d/g) || []).length;
    if (digits / base.length > 0.6 && base.length > 12) return true;
    return false;
  }

  function cleanFileName(name) {
    if (!name) return 'imagen';
    let n = String(name);
    n = n.replace(/\.[^.\/\\]+$/, '');
    n = n.replace(/\s*[\[\(][^\]\)]{0,64}[\]\)]\s*$/g, '');
    n = n.replace(/[\s._-]+[0-9a-f]{6,}$/i, '');
    n = n.replace(/[\s._-]+(copy|copia|final|edit|edited|processed|output)$/i, '');
    n = n.replace(/\s+/g, ' ').trim();
    if (!n) n = 'imagen';
    return n;
  }

  function resolveFileName(file) {
    let candidate = (file.name || '').trim();
    if (looksLikeId(candidate)) {
      const rel = (file.webkitRelativePath || '').trim();
      if (rel) {
        const parts = rel.split('/');
        const last = parts[parts.length - 1];
        if (last && !looksLikeId(last)) candidate = last;
      }
    }
    if (looksLikeId(candidate) && file.uri) {
      try {
        const u = String(file.uri);
        const decoded = decodeURIComponent(u);
        const lastSlash = decoded.lastIndexOf('/');
        if (lastSlash >= 0 && lastSlash < decoded.length - 1) {
          const tail = decoded.slice(lastSlash + 1).split('?')[0].split('#')[0];
          if (tail && !looksLikeId(tail)) candidate = tail;
        }
      } catch (_) {}
    }
    if (looksLikeId(candidate)) {
      try {
        const d = new Date(file.lastModified || Date.now());
        const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
        candidate = `foto_${stamp}`;
      } catch (_) {
        candidate = 'imagen';
      }
    }
    return candidate || 'imagen';
  }

  // ===================================================================
  //  WORKER
  // ===================================================================
  const worker = new Worker('model-worker.js');
  let workerMsgId = 0;
  const pendingWorkerCalls = new Map();

  worker.onmessage = (e) => {
    const { id, type, progress, result, error } = e.data;
    const call = pendingWorkerCalls.get(id);
    if (!call) return;
    if (type === 'progress') { if (call.onProgress) call.onProgress(progress); }
    else if (type === 'result') { pendingWorkerCalls.delete(id); call.resolve(result); }
    else if (type === 'error') { pendingWorkerCalls.delete(id); call.reject(new Error(error)); }
  };
  worker.onerror = (err) => {
    console.error('Worker error:', err);
    for (const [id, call] of pendingWorkerCalls.entries()) {
      call.reject(new Error('Worker error: ' + (err.message || 'desconocido')));
      pendingWorkerCalls.delete(id);
    }
  };
  function callWorker(action, payload, onProgress) {
    return new Promise((resolve, reject) => {
      const id = ++workerMsgId;
      pendingWorkerCalls.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, action, payload });
    });
  }

  // ===================================================================
  //  WAKE LOCK
  // ===================================================================
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {}
  }
  async function releaseWakeLock() {
    try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && els.btnProcess.disabled) acquireWakeLock();
  });

  // ===================================================================
  //  SIDEBAR
  // ===================================================================
  function isMobile() { return window.matchMedia('(max-width: 720px)').matches; }
  function openSidebar() { els.sidebar.classList.add('open'); els.sidebarOverlay.classList.add('visible'); }
  function closeSidebar() { els.sidebar.classList.remove('open'); els.sidebarOverlay.classList.remove('visible'); }
  function toggleDesktopSidebar() {
    const collapsed = els.appMain.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  }
  els.btnMenu.addEventListener('click', () => {
    if (isMobile()) {
      if (els.sidebar.classList.contains('open')) closeSidebar();
      else openSidebar();
    } else toggleDesktopSidebar();
  });
  els.btnCloseSidebar.addEventListener('click', closeSidebar);
  els.sidebarOverlay.addEventListener('click', () => {
    if (isMobile()) closeSidebar();
    else {
      els.appMain.classList.remove('sidebar-collapsed');
      localStorage.setItem('sidebarCollapsed', '0');
    }
  });
  (function initSidebarState() {
    if (!isMobile() && localStorage.getItem('sidebarCollapsed') === '1') {
      els.appMain.classList.add('sidebar-collapsed');
    }
  })();
  ['btnProcess', 'btnOpen', 'btnReset', 'btnManageModels',
   'btnApplyMask', 'btnApplyColor', 'btnApplyFill', 'btnClearFill',
   'btnApplyBlur', 'btnClearBlur'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => { if (isMobile()) setTimeout(closeSidebar, 150); });
  });
  window.addEventListener('resize', () => { if (!isMobile()) closeSidebar(); });

  // ===================================================================
  //  TEMA
  // ===================================================================
  (function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  })();
  els.themeSwitch.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    syncBgSectionWithCurrentTheme();
  });

  // ===================================================================
  //  FONDO CANVAS
  // ===================================================================
  (function initBgConfig() {
    try {
      const saved = localStorage.getItem('bgConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.light) state.bgConfig.light = { ...state.bgConfig.light, ...parsed.light };
        if (parsed.dark)  state.bgConfig.dark  = { ...state.bgConfig.dark,  ...parsed.dark  };
      }
    } catch (_) {}
  })();
  function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
  function applyCanvasBg() {
    const theme = currentTheme();
    const cfg = state.bgConfig[theme];
    const area = els.canvasArea;
    if (cfg.mode === 'solid') {
      area.classList.add('no-pattern');
      area.style.setProperty('--canvas-bg', cfg.color);
    } else {
      area.classList.remove('no-pattern');
      area.style.setProperty('--canvas-bg', theme === 'light' ? '#eef0f5' : '#252938');
    }
  }
  function syncBgSectionWithCurrentTheme() {
    const theme = currentTheme();
    const cfg = state.bgConfig[theme];
    if (cfg.mode === 'solid') els.bgModeSolid.checked = true;
    else els.bgModeChecker.checked = true;
    els.bgSolidColor.value = cfg.color;
    els.bgSolidHex.value = cfg.color;
    els.bgSolidField.classList.toggle('visible', cfg.mode === 'solid');
    applyCanvasBg();
  }
  function saveBgConfig() { localStorage.setItem('bgConfig', JSON.stringify(state.bgConfig)); }
  els.bgModeChecker.addEventListener('change', () => {
    state.bgConfig[currentTheme()].mode = 'checker';
    els.bgSolidField.classList.remove('visible');
    saveBgConfig(); applyCanvasBg();
  });
  els.bgModeSolid.addEventListener('change', () => {
    state.bgConfig[currentTheme()].mode = 'solid';
    els.bgSolidField.classList.add('visible');
    saveBgConfig(); applyCanvasBg();
  });
  els.bgSolidColor.addEventListener('input', (e) => {
    els.bgSolidHex.value = e.target.value;
    state.bgConfig[currentTheme()].color = e.target.value;
    saveBgConfig(); applyCanvasBg();
  });
  els.bgSolidHex.addEventListener('input', (e) => {
    const v = e.target.value;
    if (/^#?[a-f\d]{6}$/i.test(v)) {
      const hex = v.startsWith('#') ? v : '#' + v;
      els.bgSolidColor.value = hex;
      state.bgConfig[currentTheme()].color = hex;
      saveBgConfig(); applyCanvasBg();
    }
  });
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      els.bgSolidColor.value = color;
      els.bgSolidHex.value = color;
      els.bgModeSolid.checked = true;
      els.bgSolidField.classList.add('visible');
      state.bgConfig[currentTheme()].mode = 'solid';
      state.bgConfig[currentTheme()].color = color;
      saveBgConfig(); applyCanvasBg();
    });
  });
  els.btnBgApplyLight.addEventListener('click', () => {
    state.bgConfig.light = { mode: els.bgModeSolid.checked ? 'solid' : 'checker', color: els.bgSolidColor.value };
    saveBgConfig(); setStatus('Fondo aplicado al tema Claro');
  });
  els.btnBgApplyDark.addEventListener('click', () => {
    state.bgConfig.dark = { mode: els.bgModeSolid.checked ? 'solid' : 'checker', color: els.bgSolidColor.value };
    saveBgConfig(); setStatus('Fondo aplicado al tema Oscuro');
  });

  // ===================================================================
  //  FILL BACKGROUND
  // ===================================================================
  els.fillEnabled.addEventListener('change', (e) => {
    state.fill.enabled = e.target.checked;
    updateFillUI(); applyMaskToCurrent();
  });
  els.fillColor.addEventListener('input', (e) => {
    els.fillColorHex.value = e.target.value;
    state.fill.color = e.target.value;
    if (state.fill.enabled) applyMaskToCurrent();
  });
  els.fillColorHex.addEventListener('input', (e) => {
    const v = e.target.value;
    if (/^#?[a-f\d]{6}$/i.test(v)) {
      const hex = v.startsWith('#') ? v : '#' + v;
      els.fillColor.value = hex; state.fill.color = hex;
      if (state.fill.enabled) applyMaskToCurrent();
    }
  });
  els.fillOpacity.addEventListener('input', (e) => {
    state.fill.opacity = parseInt(e.target.value);
    els.fillOpacityVal.textContent = state.fill.opacity;
    if (state.fill.enabled) applyMaskToCurrent();
  });
  document.querySelectorAll('.swatch-fill').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      els.fillColor.value = color; els.fillColorHex.value = color;
      state.fill.color = color;
      if (!state.fill.enabled) {
        state.fill.enabled = true; els.fillEnabled.checked = true; updateFillUI();
      }
      applyMaskToCurrent();
    });
  });
  els.btnFillPickColor.addEventListener('click', () => {
    state.colorPickMode = 'fill';
    els.btnFillPickColor.style.background = 'var(--primary)';
    els.btnFillPickColor.style.color = '#fff';
    els.btnFillPickColor.querySelector('img').style.filter = 'brightness(0) invert(1)';
    setStatus('Clic en la imagen para tomar color de relleno');
  });
  els.btnApplyFill.addEventListener('click', () => {
    state.fill.enabled = true; els.fillEnabled.checked = true;
    updateFillUI(); applyMaskToCurrent();
    setStatus('Fondo rellenado');
  });
  els.btnClearFill.addEventListener('click', () => {
    state.fill.enabled = false; els.fillEnabled.checked = false;
    updateFillUI(); applyMaskToCurrent();
    setStatus('Relleno quitado');
  });
  function updateFillUI() {
    const on = !!state.fill.enabled;
    els.btnClearFill.disabled = !state.originalImage || !on;
    els.btnApplyFill.disabled = !state.originalImage;
  }

  // ===================================================================
  //  BACKGROUND BLUR
  // ===================================================================
  els.blurEnabled.addEventListener('change', (e) => {
    state.blur.enabled = e.target.checked;
    updateBlurUI(); applyMaskToCurrent();
  });
  els.blurAmount.addEventListener('input', (e) => {
    state.blur.amount = parseInt(e.target.value);
    els.blurAmountVal.textContent = state.blur.amount;
    if (state.blur.enabled) applyMaskToCurrent();
  });
  els.blurDark.addEventListener('input', (e) => {
    state.blur.darken = parseInt(e.target.value);
    els.blurDarkVal.textContent = state.blur.darken;
    if (state.blur.enabled) applyMaskToCurrent();
  });
  els.btnApplyBlur.addEventListener('click', () => {
    state.blur.enabled = true; els.blurEnabled.checked = true;
    updateBlurUI(); applyMaskToCurrent();
    setStatus('Desenfoque aplicado');
  });
  els.btnClearBlur.addEventListener('click', () => {
    state.blur.enabled = false; els.blurEnabled.checked = false;
    updateBlurUI(); applyMaskToCurrent();
    setStatus('Desenfoque quitado');
  });
  function updateBlurUI() {
    const on = !!state.blur.enabled;
    els.btnClearBlur.disabled = !state.originalImage || !on;
    els.btnApplyBlur.disabled = !state.originalImage;
  }

  // ===================================================================
  //  COLAPSIBLES
  // ===================================================================
  document.querySelectorAll('.collapsible').forEach(sec => {
    sec.classList.add('open');
    sec.querySelector('.section-title').addEventListener('click', () => {
      sec.classList.toggle('open');
    });
  });

  // ===================================================================
  //  MODAL AYUDA
  // ===================================================================
  els.btnHelp.addEventListener('click', () => { els.helpModal.hidden = false; });
  els.helpClose.addEventListener('click', () => { els.helpModal.hidden = true; });
  els.helpModal.addEventListener('click', (e) => {
    if (e.target === els.helpModal) els.helpModal.hidden = true;
  });
  document.querySelectorAll('.help-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.help-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.querySelector(`.help-panel[data-panel="${target}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  // ===================================================================
  //  CARGA IMAGEN
  // ===================================================================
  els.btnOpen.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) loadImageFile(f);
    els.fileInput.value = '';
  });

  async function loadImageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      const nameLower = (file && file.name || '').toLowerCase();
      const okExt = /\.(png|jpe?g|webp|bmp|gif)$/i.test(nameLower);
      if (!file || !okExt) {
        alert('Por favor selecciona una imagen válida');
        return;
      }
    }

    const resolvedName = resolveFileName(file);
    els.fileName.textContent = resolvedName;
    state.originalFileName = cleanFileName(resolvedName);

    const isJpeg = (file.type === 'image/jpeg') ||
                   /\.jpe?g$/i.test(file.name || '') ||
                   /\.jpe?g$/i.test(resolvedName);
    if (isJpeg) {
      const bufReader = new FileReader();
      bufReader.onload = (ev) => { originalFileBuffer = ev.target.result; };
      bufReader.readAsArrayBuffer(file);
    } else {
      originalFileBuffer = null;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      state.originalImage = img;

      const oc = createCanvas(img.width, img.height);
      oc.getContext('2d').drawImage(img, 0, 0);
      state.originalCanvas = oc;

      const cc = createCanvas(img.width, img.height);
      cc.getContext('2d').drawImage(img, 0, 0);
      state.currentCanvas = cc;

      resetMask();
      state.hasProcessed = false;
      state.displayOriginal = false;
      state.maskBackup = null;
      state.lastBrushPoint = null;
      state.fill.enabled = false; els.fillEnabled.checked = false;
      state.blur.enabled = false; els.blurEnabled.checked = false;

      state.history = [];
      state.historyIndex = -1;
      pushMaskHistory();

      resizeCanvases();
      fitToView();
      render();
      updateUI();
      updateFillUI();
      updateBlurUI();
      setStatus('Imagen cargada');
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('No se pudo cargar la imagen'); };
    img.src = url;
  }

  function resetMask() {
    const w = state.originalCanvas.width;
    const h = state.originalCanvas.height;
    const mc = createCanvas(w, h);
    const mctx = mc.getContext('2d');
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, w, h);
    state.maskCanvas = mc;
  }

  function resizeCanvases() {
    const img = state.originalImage;

    // Configurar mainCanvas a resolución completa
    els.mainCanvas.width = img.width;
    els.mainCanvas.height = img.height;
    els.mainCanvas.style.width = img.width + 'px';
    els.mainCanvas.style.height = img.height + 'px';

    // Decidir si usamos overlay reducido (solo Android + imágenes grandes)
    const totalPixels = img.width * img.height;
    const useHalfOverlay = IS_LOW_GPU && totalPixels > LARGE_IMAGE_PIXELS;

    if (useHalfOverlay) {
      state.overlayScale = OVERLAY_SCALE_LOW;
      const ow = Math.round(img.width * OVERLAY_SCALE_LOW);
      const oh = Math.round(img.height * OVERLAY_SCALE_LOW);
      els.overlayCanvas.width = ow;
      els.overlayCanvas.height = oh;
      // Escalar visualmente al tamaño original con CSS
      els.overlayCanvas.style.width = img.width + 'px';
      els.overlayCanvas.style.height = img.height + 'px';
      console.log('[overlay] Reducido a', ow + 'x' + oh, '| scale:', OVERLAY_SCALE_LOW);
    } else {
      state.overlayScale = 1;
      els.overlayCanvas.width = img.width;
      els.overlayCanvas.height = img.height;
      els.overlayCanvas.style.width = img.width + 'px';
      els.overlayCanvas.style.height = img.height + 'px';
    }

    els.dims.textContent = `${img.width} × ${img.height} px`;
    els.emptyState.hidden = true;
    els.canvasViewport.hidden = false;
  }

  // ===================================================================
  //  TRANSFORM
  // ===================================================================
  function fitToView() {
    if (!state.originalImage) return;
    const area = els.canvasArea.getBoundingClientRect();
    const img = state.originalImage;
    const padding = 40;
    const sx = (area.width - padding) / img.width;
    const sy = (area.height - padding) / img.height;
    state.zoom = Math.max(0.01, Math.min(sx, sy));
    state.panX = (area.width - img.width * state.zoom) / 2;
    state.panY = (area.height - img.height * state.zoom) / 2;
    applyTransform();
  }
  function zoomTo(percent) {
    if (!state.originalImage) return;
    const area = els.canvasArea.getBoundingClientRect();
    zoomAtPoint(percent / 100, area.width / 2, area.height / 2);
  }
  function applyTransform() {
    els.canvasInner.style.transform =
      `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    els.zoomVal.textContent = Math.round(state.zoom * 100) + '%';
  }
  function zoomAtPoint(newZoom, screenX, screenY) {
    newZoom = clamp(newZoom, 0.05, 20);
    const oldZoom = state.zoom;
    state.panX = screenX - (screenX - state.panX) * (newZoom / oldZoom);
    state.panY = screenY - (screenY - state.panY) * (newZoom / oldZoom);
    state.zoom = newZoom;
    applyTransform();
  }

  // ===================================================================
  //  RENDER
  // ===================================================================
  function render() {
    if (!state.originalImage) return;
    const src = state.displayOriginal ? state.originalCanvas : state.currentCanvas;
    ctx.clearRect(0, 0, els.mainCanvas.width, els.mainCanvas.height);
    if (src) ctx.drawImage(src, 0, 0);

    // Overlay: coordenadas según su tamaño interno (puede estar reducido)
    const ow = els.overlayCanvas.width;
    const oh = els.overlayCanvas.height;
    overlayCtx.clearRect(0, 0, ow, oh);

    // Overlay rosado de la máscara
    if (state.maskEditorActive && state.maskCanvas) {
      const tmp = createCanvas(ow, oh);
      const tctx = tmp.getContext('2d');
      tctx.fillStyle = 'rgba(255, 105, 180, 0.45)';
      tctx.fillRect(0, 0, ow, oh);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(state.maskCanvas, 0, 0, ow, oh);
      overlayCtx.drawImage(tmp, 0, 0);
    }

    // Preview rect / lasso (coordenadas de imagen → overlay coords)
    if (state.maskEditorActive && state.isDrawingShape) {
      const s = state.overlayScale;
      overlayCtx.save();
      overlayCtx.strokeStyle = 'rgba(79, 70, 229, 0.95)';
      overlayCtx.fillStyle = 'rgba(79, 70, 229, 0.20)';
      overlayCtx.lineWidth = Math.max(1, (2 / state.zoom) * s);
      overlayCtx.setLineDash([(6 / state.zoom) * s, (4 / state.zoom) * s]);

      if (state.activeTool === 'rect' && state.shapeStart && state.shapeCurrent) {
        const x = Math.min(state.shapeStart.x, state.shapeCurrent.x) * s;
        const y = Math.min(state.shapeStart.y, state.shapeCurrent.y) * s;
        const w = Math.abs(state.shapeCurrent.x - state.shapeStart.x) * s;
        const h = Math.abs(state.shapeCurrent.y - state.shapeStart.y) * s;
        overlayCtx.fillRect(x, y, w, h);
        overlayCtx.strokeRect(x, y, w, h);
      } else if (state.activeTool === 'lasso' && state.lassoPoints.length > 1) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(state.lassoPoints[0].x * s, state.lassoPoints[0].y * s);
        for (let i = 1; i < state.lassoPoints.length; i++) {
          overlayCtx.lineTo(state.lassoPoints[i].x * s, state.lassoPoints[i].y * s);
        }
        overlayCtx.closePath();
        overlayCtx.fill();
        overlayCtx.stroke();
      }
      overlayCtx.restore();
    }
  }

  /**
   * Aplica la máscara a currentCanvas con soporte para fill y blur.
   * En Android, el blur se hace con downscale+upscale para reducir la carga GPU.
   */
  function applyMaskToCurrent() {
    if (!state.originalCanvas || !state.maskCanvas) return;
    const w = state.originalCanvas.width;
    const h = state.originalCanvas.height;

    // 1) Recorte (imagen original con alpha de la máscara)
    const cut = createCanvas(w, h);
    const cctx = cut.getContext('2d');
    cctx.drawImage(state.originalCanvas, 0, 0);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(state.maskCanvas, 0, 0);

    // 2) Fondo
    const cc = state.currentCanvas.getContext('2d');
    cc.clearRect(0, 0, w, h);

    const backgroundOn = state.fill.enabled || state.blur.enabled;
    if (backgroundOn) {
      const bg = createCanvas(w, h);
      const bctx = bg.getContext('2d');

      if (state.blur.enabled && state.blur.amount > 0) {
        if (IS_LOW_GPU) {
          // === Optimización Android: downscale + upscale ===
          // Dibujamos la imagen a 1/4 de tamaño, aplicamos filter: blur() sobre
          // el canvas pequeño (que es MUCHO más barato en GPU), y luego
          // escalamos al tamaño final con imageSmoothing de alta calidad.
          const bw = Math.max(1, Math.round(w / 4));
          const bh = Math.max(1, Math.round(h / 4));

          const small = createCanvas(bw, bh);
          const sctx = small.getContext('2d');
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';

          // El blur se aplica al reducir: usamos el blur proporcional (1/4 del solicitado)
          const scaledBlur = Math.max(1, state.blur.amount / 4);
          sctx.filter = `blur(${scaledBlur}px)`;
          sctx.drawImage(state.originalCanvas, 0, 0, bw, bh);
          sctx.filter = 'none';

          // Upscale al tamaño final
          bctx.imageSmoothingEnabled = true;
          bctx.imageSmoothingQuality = 'high';
          bctx.drawImage(small, 0, 0, bw, bh, 0, 0, w, h);
        } else {
          // Desktop: blur nativo al tamaño completo
          bctx.filter = `blur(${state.blur.amount}px)`;
          bctx.drawImage(state.originalCanvas, 0, 0);
          bctx.filter = 'none';
        }

        // Oscurecer fondo
        if (state.blur.darken > 0) {
          bctx.fillStyle = `rgba(0,0,0,${state.blur.darken / 100})`;
          bctx.fillRect(0, 0, w, h);
        }
      } else if (state.fill.enabled) {
        const rgb = hexToRgb(state.fill.color) || { r: 255, g: 255, b: 255 };
        const alpha = clamp(state.fill.opacity / 100, 0, 1);
        bctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        bctx.fillRect(0, 0, w, h);
      }

      cc.drawImage(bg, 0, 0);
    }

    // 3) Sujeto encima
    cc.drawImage(cut, 0, 0);

    state.hasProcessed = true;
    state.displayOriginal = false;
    render();
    updateUI();
    updateFillUI();
    updateBlurUI();
  }

  function updateUI() {
    const hasImg = !!state.originalImage;
    els.btnProcess.disabled = !hasImg;
    els.btnZoomFit.disabled = !hasImg;
    els.btnToggleView.disabled = !hasImg || !state.hasProcessed;
    els.btnCopy.disabled = !hasImg;
    els.btnSave.disabled = !hasImg;
    els.btnReset.disabled = !hasImg;
    els.btnApplyColor.disabled = !hasImg;
    els.btnApplyFill.disabled = !hasImg;
    els.btnClearFill.disabled = !hasImg || !state.fill.enabled;
    els.btnApplyBlur.disabled = !hasImg;
    els.btnClearBlur.disabled = !hasImg || !state.blur.enabled;
    updateUndoRedoUI();
  }

  // ===================================================================
  //  HISTORIAL
  // ===================================================================
  function snapshotMask() {
    const w = state.maskCanvas.width;
    const h = state.maskCanvas.height;
    const c = createCanvas(w, h);
    c.getContext('2d').drawImage(state.maskCanvas, 0, 0);
    return c;
  }
  function pushMaskHistory() {
    if (state.isPerformingUndoRedo) return;
    if (!state.maskCanvas) return;
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshotMask());
    if (state.history.length > state.historyMax) {
      state.history.shift();
    } else {
      state.historyIndex++;
    }
    updateUndoRedoUI();
  }
  function undo() {
    if (!state.maskEditorActive) return;
    if (state.historyIndex <= 0) { setStatus('Nada que deshacer'); return; }
    state.historyIndex--;
    restoreMaskHistory();
    setStatus('Deshacer');
  }
  function redo() {
    if (!state.maskEditorActive) return;
    if (state.historyIndex >= state.history.length - 1) { setStatus('Nada que rehacer'); return; }
    state.historyIndex++;
    restoreMaskHistory();
    setStatus('Rehacer');
  }
  function restoreMaskHistory() {
    const snap = state.history[state.historyIndex];
    if (!snap) return;
    state.isPerformingUndoRedo = true;
    const mctx = state.maskCanvas.getContext('2d');
    mctx.clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
    mctx.globalCompositeOperation = 'source-over';
    mctx.drawImage(snap, 0, 0);
    state.isPerformingUndoRedo = false;
    applyMaskToCurrent();
    if (state.maskEditorActive) render();
    updateUndoRedoUI();
  }
  function updateUndoRedoUI() {
    if (!els.btnUndo || !els.btnRedo) return;
    const canUndo = state.maskEditorActive && state.historyIndex > 0;
    const canRedo = state.maskEditorActive && state.historyIndex < state.history.length - 1;
    els.btnUndo.disabled = !canUndo;
    els.btnRedo.disabled = !canRedo;
  }
  els.btnUndo.addEventListener('click', undo);
  els.btnRedo.addEventListener('click', redo);

  // ===================================================================
  //  WHEEL
  // ===================================================================
  els.canvasArea.addEventListener('wheel', (e) => {
    if (!state.originalImage) return;
    e.preventDefault();
    if (e.shiftKey) { state.panX -= e.deltaY; applyTransform(); return; }
    if (e.altKey)   { state.panY -= e.deltaY; applyTransform(); return; }
    const rect = els.canvasArea.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAtPoint(state.zoom * factor, mx, my);
  }, { passive: false });

  // ===================================================================
  //  POINTERS (con delay para Android)
  // ===================================================================
  function cancelPendingStroke() {
    if (state.pendingStroke) {
      clearTimeout(state.pendingStroke.timeoutId);
      state.pendingStroke = null;
    }
  }
  function executePendingStroke(pending, e) {
    cancelPendingStroke();
    if (!pending) return;
    const tool = pending.tool;
    const ev = pending.lastEvent || e;
    if (tool === 'wand') doMagicWand(ev);
    else if (tool === 'rect') { state.isDrawingShape = true; state.shapeStart = eventToImageCoords(ev); state.shapeCurrent = { ...state.shapeStart }; render(); }
    else if (tool === 'lasso') { state.isDrawingShape = true; state.lassoPoints = [eventToImageCoords(ev)]; render(); }
    else startBrushStroke(ev);
  }

  els.canvasArea.addEventListener('pointerdown', (e) => {
    if (!state.originalImage) return;
    state.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (state.activePointers.size === 2) {
      cancelPendingStroke();
      state.isDrawing = false;
      state.lastBrushPoint = null;
      state.isDrawingShape = false;
      state.shapeStart = null;
      state.shapeCurrent = null;
      state.lassoPoints = [];
      state.isPanning = false;
      startPinch();
      try { els.canvasArea.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      return;
    }

    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isSpace = state.spacePressed;
    const editingMask = state.maskEditorActive;
    const pickingColor = state.colorPickMode;
    const isTouch = e.pointerType === 'touch';

    let wantPan;
    if (isTouch) wantPan = !editingMask && !pickingColor;
    else wantPan = isMiddle || isRight || isSpace || (!editingMask && !pickingColor);

    if (wantPan) {
      state.isPanning = true;
      state.lastPointer = { x: e.clientX, y: e.clientY };
      els.canvasArea.classList.add('panning');
      try { els.canvasArea.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      return;
    }

    if (!isTouch && e.button !== 0) return;
    if (pickingColor) { pickColorFromImage(e); return; }

    if (editingMask && isTouch) {
      const pending = {
        pointerId: e.pointerId,
        tool: state.activeTool,
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastEvent: e,
        timeoutId: null
      };
      pending.timeoutId = setTimeout(() => {
        if (state.activePointers.size === 1 && state.pendingStroke === pending) {
          executePendingStroke(pending, pending.lastEvent);
        }
      }, state.pendingStrokeDelay);
      state.pendingStroke = pending;
      e.preventDefault();
      return;
    }

    if (editingMask) {
      if (state.activeTool === 'wand') doMagicWand(e);
      else if (state.activeTool === 'rect') startRect(e);
      else if (state.activeTool === 'lasso') startLasso(e);
      else startBrushStroke(e);
    }
  });

  els.canvasArea.addEventListener('pointermove', (e) => {
    if (!state.originalImage) return;
    if (state.activePointers.has(e.pointerId)) {
      state.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (state.activePointers.size >= 2 && state.pinchStart) { updatePinch(); return; }

    if (state.pendingStroke && state.pendingStroke.pointerId === e.pointerId) {
      state.pendingStroke.lastEvent = e;
      const dx = e.clientX - state.pendingStroke.startClientX;
      const dy = e.clientY - state.pendingStroke.startClientY;
      const dist = Math.hypot(dx, dy);
      if (dist > 8) {
        const p = state.pendingStroke;
        cancelPendingStroke();
        executePendingStroke(p, e);
      }
      return;
    }

    updateCursor(e);
    if (state.isPanning) {
      const dx = e.clientX - state.lastPointer.x;
      const dy = e.clientY - state.lastPointer.y;
      state.panX += dx; state.panY += dy;
      state.lastPointer = { x: e.clientX, y: e.clientY };
      applyTransform();
      return;
    }
    if (state.isDrawing) continueBrushStroke(e);
    if (state.isDrawingShape) continueShape(e);
  });

  function endPointer(e) {
    state.activePointers.delete(e.pointerId);
    if (state.pendingStroke && state.pendingStroke.pointerId === e.pointerId) {
      const p = state.pendingStroke;
      cancelPendingStroke();
      executePendingStroke(p, e);
    }
    if (state.pinchStart && state.activePointers.size < 2) state.pinchStart = null;
    if (state.isPanning && state.activePointers.size === 0) {
      state.isPanning = false;
      els.canvasArea.classList.remove('panning');
      try { els.canvasArea.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    if (state.isDrawing && state.activePointers.size === 0) {
      state.isDrawing = false;
      state.lastBrushPoint = null;
      pushMaskHistory();
    }
    if (state.isDrawingShape && state.activePointers.size === 0) {
      finishShape(e);
    }
  }
  els.canvasArea.addEventListener('pointerup', endPointer);
  els.canvasArea.addEventListener('pointercancel', endPointer);
  els.canvasArea.addEventListener('pointerleave', () => {
    els.brushCursor.classList.remove('show');
  });
  els.canvasArea.addEventListener('contextmenu', (e) => { if (state.originalImage) e.preventDefault(); });

  // ===================================================================
  //  PINCH ZOOM
  // ===================================================================
  function startPinch() {
    const pts = Array.from(state.activePointers.values());
    if (pts.length < 2) return;
    const [p1, p2] = pts;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const rect = els.canvasArea.getBoundingClientRect();
    state.pinchStart = {
      dist, zoom: state.zoom, panX: state.panX, panY: state.panY,
      midX, midY,
      areaMidX: midX - rect.left, areaMidY: midY - rect.top
    };
  }
  function updatePinch() {
    if (!state.pinchStart) return;
    const pts = Array.from(state.activePointers.values());
    if (pts.length < 2) return;
    const [p1, p2] = pts;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const start = state.pinchStart;
    const scale = dist / start.dist;
    const newZoom = clamp(start.zoom * scale, 0.05, 20);
    const midDx = midX - start.midX;
    const midDy = midY - start.midY;
    state.panX = start.areaMidX - (start.areaMidX - start.panX) * (newZoom / start.zoom) + midDx;
    state.panY = start.areaMidY - (start.areaMidY - start.panY) * (newZoom / start.zoom) + midDy;
    state.zoom = newZoom;
    applyTransform();
  }

  // ===================================================================
  //  CURSOR
  // ===================================================================
  function updateCursor(e) {
    els.canvasArea.classList.remove('brush-mode', 'magic-mode', 'pick-mode', 'crosshair-mode');
    const inPanState = state.spacePressed || state.isPanning;
    if (state.colorPickMode && !inPanState) {
      els.canvasArea.classList.add('pick-mode'); els.brushCursor.classList.remove('show'); return;
    }
    if (state.maskEditorActive && !inPanState) {
      if (state.activeTool === 'wand') {
        els.canvasArea.classList.add('magic-mode'); els.brushCursor.classList.remove('show'); return;
      }
      if (state.activeTool === 'rect' || state.activeTool === 'lasso') {
        els.canvasArea.classList.add('crosshair-mode'); els.brushCursor.classList.remove('show'); return;
      }
      els.canvasArea.classList.add('brush-mode');
      const rect = els.canvasArea.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const size = state.brushSize * state.zoom;
      els.brushCursor.style.width = size + 'px';
      els.brushCursor.style.height = size + 'px';
      els.brushCursor.style.left = x + 'px';
      els.brushCursor.style.top = y + 'px';
      els.brushCursor.classList.add('show');
      return;
    }
    els.brushCursor.classList.remove('show');
  }

  function eventToImageCoords(e) {
    const rect = els.canvasArea.getBoundingClientRect();
    const x = (e.clientX - rect.left - state.panX) / state.zoom;
    const y = (e.clientY - rect.top - state.panY) / state.zoom;
    return { x, y };
  }

  // ===================================================================
  //  MASK EDITOR toggle
  // ===================================================================
  els.maskEditorToggle.addEventListener('change', (e) => {
    state.maskEditorActive = e.target.checked;
    els.maskEditorBody.classList.toggle('disabled', !state.maskEditorActive);
    if (!state.maskEditorActive) {
      cancelPendingStroke();
      els.brushCursor.classList.remove('show');
      els.canvasArea.classList.remove('brush-mode', 'magic-mode', 'crosshair-mode');
    } else pushMaskHistory();
    render();
    updateUndoRedoUI();
    setStatus(state.maskEditorActive ? 'Editor de máscara activo' : 'Editor desactivado');
  });

  // ===================================================================
  //  TOOL SELECT
  // ===================================================================
  els.toolGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool-btn');
    if (!btn) return;
    els.toolGroup.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeTool = btn.dataset.tool;
    if (state.activeTool === 'brush') {
      els.brushSizeField.style.display = '';
      els.smartOpts.classList.add('hidden');
      els.shapeOpts.classList.add('hidden');
    } else if (state.activeTool === 'wand') {
      els.brushSizeField.style.display = 'none';
      els.smartOpts.classList.remove('hidden');
      els.shapeOpts.classList.add('hidden');
    } else if (state.activeTool === 'rect') {
      els.brushSizeField.style.display = 'none';
      els.smartOpts.classList.add('hidden');
      els.shapeOpts.classList.remove('hidden');
      els.shapeHint.textContent = 'Arrastra para dibujar el rectángulo.';
    } else if (state.activeTool === 'lasso') {
      els.brushSizeField.style.display = 'none';
      els.smartOpts.classList.add('hidden');
      els.shapeOpts.classList.remove('hidden');
      els.shapeHint.textContent = 'Arrastra para trazar el lazo. Suelta para aplicar.';
    }
    setStatus('Herramienta: ' + state.activeTool);
  });

  // ===================================================================
  //  PINCEL
  // ===================================================================
  function startBrushStroke(e) {
    if (!state.maskCanvas) return;
    state.isDrawing = true;
    state.lastBrushPoint = null;
    paintBrushAt(e);
  }
  function continueBrushStroke(e) { paintBrushAt(e); }
  function paintBrushAt(e) {
    const { x, y } = eventToImageCoords(e);
    const mctx = state.maskCanvas.getContext('2d');
    const r = state.brushSize / 2;
    if (state.brushMode === 'add') {
      mctx.globalCompositeOperation = 'source-over';
      mctx.strokeStyle = '#ffffff';
      mctx.fillStyle = '#ffffff';
    } else {
      mctx.globalCompositeOperation = 'destination-out';
      mctx.strokeStyle = 'rgba(0,0,0,1)';
      mctx.fillStyle = 'rgba(0,0,0,1)';
    }
    mctx.lineWidth = state.brushSize;
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    if (state.lastBrushPoint) {
      mctx.beginPath();
      mctx.moveTo(state.lastBrushPoint.x, state.lastBrushPoint.y);
      mctx.lineTo(x, y);
      mctx.stroke();
    } else {
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fill();
    }
    state.lastBrushPoint = { x, y };
    applyMaskToCurrent();
    if (state.maskEditorActive) render();
  }

  // ===================================================================
  //  RECT / LASSO
  // ===================================================================
  function startRect(e) {
    state.isDrawingShape = true;
    state.shapeStart = eventToImageCoords(e);
    state.shapeCurrent = { ...state.shapeStart };
    render();
  }
  function startLasso(e) {
    state.isDrawingShape = true;
    state.lassoPoints = [eventToImageCoords(e)];
    render();
  }
  function continueShape(e) {
    if (state.activeTool === 'rect') {
      state.shapeCurrent = eventToImageCoords(e);
      render();
    } else if (state.activeTool === 'lasso') {
      const p = eventToImageCoords(e);
      const last = state.lassoPoints[state.lassoPoints.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) {
        state.lassoPoints.push(p);
        render();
      }
    }
  }
  function finishShape(e) {
    if (!state.isDrawingShape) return;
    state.isDrawingShape = false;
    const mctx = state.maskCanvas.getContext('2d');
    const isAdd = state.brushMode === 'add';
    if (state.activeTool === 'rect' && state.shapeStart && state.shapeCurrent) {
      const x = Math.min(state.shapeStart.x, state.shapeCurrent.x);
      const y = Math.min(state.shapeStart.y, state.shapeCurrent.y);
      const w = Math.abs(state.shapeCurrent.x - state.shapeStart.x);
      const h = Math.abs(state.shapeCurrent.y - state.shapeStart.y);
      if (w < 1 || h < 1) { state.shapeStart = null; state.shapeCurrent = null; return; }
      if (isAdd) {
        mctx.globalCompositeOperation = 'source-over';
        mctx.fillStyle = '#ffffff';
        mctx.fillRect(x, y, w, h);
      } else {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.fillStyle = 'rgba(0,0,0,1)';
        mctx.fillRect(x, y, w, h);
      }
    } else if (state.activeTool === 'lasso' && state.lassoPoints.length > 2) {
      const pts = state.lassoPoints;
      mctx.save();
      if (isAdd) {
        mctx.globalCompositeOperation = 'source-over';
        mctx.fillStyle = '#ffffff';
      } else {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.fillStyle = 'rgba(0,0,0,1)';
      }
      mctx.beginPath();
      mctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) mctx.lineTo(pts[i].x, pts[i].y);
      mctx.closePath();
      mctx.fill();
      mctx.restore();
    }
    state.shapeStart = null;
    state.shapeCurrent = null;
    state.lassoPoints = [];
    applyMaskToCurrent();
    if (state.maskEditorActive) render();
    pushMaskHistory();
    setStatus('Selección aplicada');
  }

  // ===================================================================
  //  VARITA MÁGICA
  // ===================================================================
  function doMagicWand(e) {
    if (!state.originalCanvas) return;
    const { x, y } = eventToImageCoords(e);
    const sx = Math.floor(x), sy = Math.floor(y);
    const w = state.originalCanvas.width, h = state.originalCanvas.height;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    setStatus('Varita mágica...');
    setTimeout(() => {
      magicWand(sx, sy);
      applyMaskToCurrent();
      if (state.maskEditorActive) render();
      pushMaskHistory();
      setStatus('Selección aplicada');
    }, 0);
  }
  function magicWand(sx, sy) {
    const w = state.originalCanvas.width, h = state.originalCanvas.height;
    const imgData = state.originalCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    const colorTol = parseInt(els.smartColor.value) / 100;
    const edgeTol = parseInt(els.smartEdge.value) / 100;
    const maxDist = 441.67;
    const tolerance = Math.max((colorTol * 0.7 + edgeTol * 0.3) * maxDist, 5);
    const si = (sy * w + sx) * 4;
    const sr = imgData[si], sg = imgData[si + 1], sb = imgData[si + 2];
    const isAdd = state.brushMode === 'add';
    const mctx = state.maskCanvas.getContext('2d');
    const mImg = mctx.getImageData(0, 0, w, h);
    const mData = mImg.data;
    const visited = new Uint8Array(w * h);
    const stack = [[sx, sy]];
    const match = (px, py) => {
      const i = (py * w + px) * 4;
      const dr = imgData[i] - sr;
      const dg = imgData[i + 1] - sg;
      const db = imgData[i + 2] - sb;
      return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
    };
    const fill = (px, py) => {
      const i = (py * w + px) * 4;
      if (isAdd) { mData[i]=255; mData[i+1]=255; mData[i+2]=255; mData[i+3]=255; }
      else { mData[i]=0; mData[i+1]=0; mData[i+2]=0; mData[i+3]=0; }
    };
    while (stack.length) {
      const [x0, y0] = stack.pop();
      if (x0 < 0 || x0 >= w || y0 < 0 || y0 >= h) continue;
      if (visited[y0 * w + x0]) continue;
      if (!match(x0, y0)) continue;
      let xL = x0;
      while (xL > 0 && !visited[y0 * w + (xL - 1)] && match(xL - 1, y0)) xL--;
      let xR = x0;
      while (xR < w - 1 && !visited[y0 * w + (xR + 1)] && match(xR + 1, y0)) xR++;
      for (let x = xL; x <= xR; x++) { visited[y0 * w + x] = 1; fill(x, y0); }
      for (const yy of [y0 - 1, y0 + 1]) {
        if (yy < 0 || yy >= h) continue;
        let x = xL;
        while (x <= xR) {
          while (x <= xR && !(!visited[yy * w + x] && match(x, yy))) x++;
          if (x > xR) break;
          stack.push([x, yy]);
          while (x <= xR && !visited[yy * w + x] && match(x, yy)) x++;
        }
      }
    }
    mctx.putImageData(mImg, 0, 0);
  }

  // ===================================================================
  //  CANCELAR / APLICAR MÁSCARA
  // ===================================================================
  els.btnCancelMask.addEventListener('click', () => {
    if (state.historyIndex <= 0) { setStatus('Nada que cancelar'); return; }
    state.historyIndex = 0;
    restoreMaskHistory();
    state.maskBackup = null;
    setStatus('Edición cancelada');
  });
  els.btnApplyMask.addEventListener('click', () => {
    state.maskBackup = null;
    applyMaskToCurrent();
    if (state.maskEditorActive) render();
    pushMaskHistory();
    setStatus('Máscara aplicada');
  });

  // ===================================================================
  //  ELIMINAR POR COLOR
  // ===================================================================
  function updateTargetColorFromHex(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return false;
    state.targetColor = { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
    els.targetColor.value = '#' + m[1] + m[2] + m[3];
    return true;
  }
  els.targetColor.addEventListener('input', (e) => {
    els.targetColorHex.value = e.target.value;
    updateTargetColorFromHex(e.target.value);
  });
  els.targetColorHex.addEventListener('input', (e) => updateTargetColorFromHex(e.target.value));
  els.tolerance.addEventListener('input', (e) => els.toleranceVal.textContent = e.target.value);
  els.edge.addEventListener('input', (e) => els.edgeVal.textContent = e.target.value);
  els.smooth.addEventListener('input', (e) => els.smoothVal.textContent = e.target.value);
  els.btnPickColor.addEventListener('click', () => {
    state.colorPickMode = state.colorPickMode === 'target' ? false : 'target';
    els.btnPickColor.style.background = state.colorPickMode ? 'var(--primary)' : '';
    els.btnPickColor.style.color = state.colorPickMode ? '#fff' : '';
    if (state.colorPickMode) els.btnPickColor.querySelector('img').style.filter = 'brightness(0) invert(1)';
    else els.btnPickColor.querySelector('img').style.filter = '';
    els.btnFillPickColor.style.background = '';
    els.btnFillPickColor.style.color = '';
    els.btnFillPickColor.querySelector('img').style.filter = '';
    setStatus(state.colorPickMode ? 'Clic en la imagen para tomar color' : 'Listo');
  });
  function pickColorFromImage(e) {
    const { x, y } = eventToImageCoords(e);
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= state.originalCanvas.width || py >= state.originalCanvas.height) return;
    const d = state.originalCanvas.getContext('2d').getImageData(px, py, 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    if (state.colorPickMode === 'fill') {
      els.fillColor.value = hex; els.fillColorHex.value = hex; state.fill.color = hex;
      state.colorPickMode = false;
      els.btnFillPickColor.style.background = '';
      els.btnFillPickColor.style.color = '';
      els.btnFillPickColor.querySelector('img').style.filter = '';
      if (state.fill.enabled) applyMaskToCurrent();
      setStatus('Color de relleno: ' + hex);
    } else {
      els.targetColor.value = hex; els.targetColorHex.value = hex;
      updateTargetColorFromHex(hex);
      state.colorPickMode = false;
      els.btnPickColor.style.background = '';
      els.btnPickColor.style.color = '';
      els.btnPickColor.querySelector('img').style.filter = '';
      setStatus('Color tomado: ' + hex);
    }
    els.canvasArea.classList.remove('pick-mode');
  }
  els.btnApplyColor.addEventListener('click', () => {
    if (!state.originalCanvas) return;
    setStatus('Eliminando color...');
    setTimeout(() => {
      removeColorFromMask();
      applyMaskToCurrent();
      if (state.maskEditorActive) render();
      pushMaskHistory();
      setStatus('Color eliminado');
    }, 10);
  });
  function removeColorFromMask() {
    const w = state.originalCanvas.width, h = state.originalCanvas.height;
    const data = state.originalCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    const mImg = state.maskCanvas.getContext('2d').getImageData(0, 0, w, h);
    const mData = mImg.data;
    const tol = parseInt(els.tolerance.value);
    const edge = parseInt(els.edge.value);
    const smooth = parseInt(els.smooth.value);
    const { r: tr, g: tg, b: tb } = state.targetColor;
    const tolEuclid = tol * 0.6;
    const matchMask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const dr = data[i] - tr, dg = data[i+1] - tg, db = data[i+2] - tb;
      if (Math.sqrt(dr*dr + dg*dg + db*db) <= tolEuclid) matchMask[p] = 1;
    }
    let smoothed = matchMask;
    if (smooth > 0) smoothed = boxBlur(matchMask, w, h, smooth);
    const edgeFactor = edge / 10;
    const threshold = 0.5 - edgeFactor * 0.3;
    for (let p = 0; p < w * h; p++) {
      const di = p * 4;
      if (smoothed[p] > threshold) {
        mData[di] = 0; mData[di+1] = 0; mData[di+2] = 0; mData[di+3] = 0;
      }
    }
    state.maskCanvas.getContext('2d').putImageData(mImg, 0, 0);
  }
  function boxBlur(src, w, h, radius) {
    const out = new Float32Array(w * h);
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const row = y * w;
      const r = Math.min(radius, w - 1);
      for (let x = -r; x <= r; x++) sum += src[row + clamp(x, 0, w - 1)];
      const div = 2 * r + 1;
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / div;
        sum += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const r = Math.min(radius, h - 1);
      for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
      const div = 2 * r + 1;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / div;
        sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
      }
    }
    return out;
  }

  // ===================================================================
  //  CONTROLES
  // ===================================================================
  els.brushSize.addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value);
    els.brushSizeVal.textContent = state.brushSize;
  });
  els.brushModeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    els.brushModeGroup.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.brushMode = btn.dataset.mode;
  });
  els.smartColor.addEventListener('input', (e) => els.smartColorVal.textContent = e.target.value);
  els.smartEdge.addEventListener('input', (e) => els.smartEdgeVal.textContent = e.target.value);
  if (els.chkExif) els.chkExif.addEventListener('change', (e) => { state.copyExif = e.target.checked; });

  // ===================================================================
  //  HEADER ACTIONS
  // ===================================================================
  els.btnToggleView.addEventListener('click', () => {
    state.displayOriginal = !state.displayOriginal;
    els.btnToggleView.style.background = state.displayOriginal ? 'var(--primary)' : '';
    render();
  });
  els.btnCopy.addEventListener('click', async () => {
    try {
      const blob = await new Promise(res => els.mainCanvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Copiado al portapapeles ✓');
    } catch (err) { setStatus('Error al copiar: ' + err.message); }
  });
  els.btnZoomFit.addEventListener('click', () => {
    if (!state.originalImage) return;
    fitToView(); setStatus('Ajustado a ventana');
  });
  els.btnReset.addEventListener('click', () => {
    if (!state.originalCanvas) return;
    const cctx = state.currentCanvas.getContext('2d');
    cctx.clearRect(0, 0, state.currentCanvas.width, state.currentCanvas.height);
    cctx.drawImage(state.originalCanvas, 0, 0);
    resetMask();
    state.hasProcessed = false;
    state.displayOriginal = false;
    state.maskBackup = null;
    state.fill.enabled = false; els.fillEnabled.checked = false;
    state.blur.enabled = false; els.blurEnabled.checked = false;
    els.btnToggleView.style.background = '';
    state.history = []; state.historyIndex = -1;
    pushMaskHistory();
    render(); updateUI(); updateFillUI(); updateBlurUI();
    setStatus('Reiniciado');
  });

  // ===================================================================
  //  GUARDAR
  // ===================================================================
  els.btnSave.addEventListener('click', async () => {
    if (!state.originalCanvas) return;
    if (typeof window.showSaveFilePicker === 'function') await saveWithFilePicker();
    else saveWithFallback();
  });
  async function saveWithFilePicker() {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${state.originalFileName}-sin-fondo.png`,
        types: [
          { description: 'PNG', accept: { 'image/png': ['.png'] } },
          { description: 'JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
          { description: 'WebP', accept: { 'image/webp': ['.webp'] } },
          { description: 'BMP', accept: { 'image/bmp': ['.bmp'] } }
        ]
      });
      const ext = handle.name.split('.').pop().toLowerCase();
      let mime = 'image/png', quality;
      if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
      else if (ext === 'webp') mime = 'image/webp';
      else if (ext === 'bmp') mime = 'image/bmp';
      if (mime === 'image/jpeg') {
        quality = await askJpgQuality();
        if (quality === null) return;
        quality = quality / 100;
      }
      let blob = await new Promise(res => els.mainCanvas.toBlob(res, mime, quality));
      if (mime === 'image/jpeg' && state.copyExif) {
        try { blob = await injectExif(blob); } catch (e) { console.warn(e); }
      }
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus('Guardado ✓');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus('Error al guardar: ' + err.message);
    }
  }
  function saveWithFallback() {
    const format = prompt('Formato de salida:\n1 = PNG\n2 = JPG\n3 = WebP\n4 = BMP', '1');
    if (!format) return;
    let ext = 'png', mime = 'image/png', quality;
    if (format === '2') { ext = 'jpg'; mime = 'image/jpeg'; }
    else if (format === '3') { ext = 'webp'; mime = 'image/webp'; }
    else if (format === '4') { ext = 'bmp'; mime = 'image/bmp'; }
    if (mime === 'image/jpeg') {
      askJpgQuality().then(q => {
        if (q === null) return;
        doFallbackSave(ext, mime, q / 100);
      });
    } else doFallbackSave(ext, mime, undefined);
  }
  async function doFallbackSave(ext, mime, quality) {
    let blob = await new Promise(res => els.mainCanvas.toBlob(res, mime, quality));
    if (mime === 'image/jpeg' && state.copyExif) {
      try { blob = await injectExif(blob); } catch (e) { console.warn(e); }
    }
    const a = document.createElement('a');
    a.download = `${state.originalFileName}-sin-fondo.${ext}`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus('Guardado ✓');
  }
  function askJpgQuality() {
    return new Promise((resolve) => {
      els.jpgModal.hidden = false;
      els.jpgQualityVal.textContent = els.jpgQuality.value;
      els.chkExif.checked = state.copyExif;
      const onInput = () => els.jpgQualityVal.textContent = els.jpgQuality.value;
      const onConfirm = () => { state.copyExif = els.chkExif.checked; cleanup(); resolve(parseInt(els.jpgQuality.value)); };
      const onCancel = () => { cleanup(); resolve(null); };
      const cleanup = () => {
        els.jpgModal.hidden = true;
        els.jpgQuality.removeEventListener('input', onInput);
        els.jpgConfirm.removeEventListener('click', onConfirm);
        els.jpgCancel.removeEventListener('click', onCancel);
      };
      els.jpgQuality.addEventListener('input', onInput);
      els.jpgConfirm.addEventListener('click', onConfirm);
      els.jpgCancel.addEventListener('click', onCancel);
    });
  }

  // ===================================================================
  //  EXIF
  // ===================================================================
  function extractExifSegment(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    let i = 2;
    while (i < bytes.length - 1) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2 || i + 2 + len > bytes.length) break;
      if (marker === 0xE1) {
        const start = i + 4;
        if (start + 6 <= bytes.length &&
            bytes[start] === 0x45 && bytes[start+1] === 0x78 &&
            bytes[start+2] === 0x69 && bytes[start+3] === 0x66 &&
            bytes[start+4] === 0x00 && bytes[start+5] === 0x00) {
          return bytes.slice(i, i + 2 + len);
        }
      }
      i += 2 + len;
    }
    return null;
  }
  function insertExifIntoJpeg(jpegBytes, exifSegment) {
    if (!exifSegment || !exifSegment.length) return jpegBytes;
    const out = new Uint8Array(2 + exifSegment.length + (jpegBytes.length - 2));
    out[0] = jpegBytes[0]; out[1] = jpegBytes[1];
    out.set(exifSegment, 2);
    out.set(jpegBytes.subarray(2), 2 + exifSegment.length);
    return out;
  }
  async function injectExif(newJpegBlob) {
    if (!originalFileBuffer) return newJpegBlob;
    const origBytes = new Uint8Array(originalFileBuffer);
    const exifSegment = extractExifSegment(origBytes);
    if (!exifSegment) return newJpegBlob;
    const newBytes = new Uint8Array(await newJpegBlob.arrayBuffer());
    const merged = insertExifIntoJpeg(newBytes, exifSegment);
    return new Blob([merged], { type: 'image/jpeg' });
  }

  // ===================================================================
  //  GESTIÓN DE MODELOS
  // ===================================================================
  els.btnManageModels.addEventListener('click', async () => {
    await renderModelsList(); els.modelsModal.hidden = false;
  });
  els.modelsClose.addEventListener('click', () => { els.modelsModal.hidden = true; });
  els.modelsModal.addEventListener('click', (e) => {
    if (e.target === els.modelsModal) els.modelsModal.hidden = true;
  });
  async function renderModelsList() {
    const metas = await ModelDB.listMeta();
    const est = await ModelDB.estimate();
    els.modelsStorage.textContent = `Usado: ${formatBytes(est.usage || 0)} / ${formatBytes(est.quota || 0)}`;
    if (!metas.length) {
      els.modelsList.innerHTML = `<p class="empty-models">No hay modelos descargados aún. Se descargarán automáticamente al procesar una imagen.</p>`;
      return;
    }
    els.modelsList.innerHTML = '';
    for (const meta of metas) {
      const row = document.createElement('div');
      row.className = 'model-row';
      row.innerHTML = `
        <div class="model-info">
          <div class="model-name">${meta.label || meta.key}</div>
          <div class="model-meta">${formatBytes(meta.size)} · ${new Date(meta.date).toLocaleDateString()}</div>
        </div>
        <button class="icon-btn small" title="Eliminar" data-key="${meta.key}">
          <img src="icons/remove.png" alt="" />
        </button>`;
      els.modelsList.appendChild(row);
    }
    els.modelsList.querySelectorAll('button[data-key]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        if (!confirm(`¿Eliminar el modelo "${key}" del almacenamiento?`)) return;
        await ModelDB.deleteModel(key);
        setStatus('Modelo eliminado'); await renderModelsList();
      });
    });
  }

  // ===================================================================
  //  MODAL DE PROGRESO
  // ===================================================================
  function showProgress(title) {
    els.progressModal.hidden = false;
    els.progressTitle.textContent = title;
    els.progressBar.style.width = '0%';
    els.progressPercent.textContent = '0%';
  }
  function updateProgress(percent) {
    if (percent < 0) { els.progressBar.style.width = '100%'; els.progressPercent.textContent = '...'; return; }
    els.progressBar.style.width = percent + '%';
    els.progressPercent.textContent = percent + '%';
  }
  function hideProgress() { els.progressModal.hidden = true; }
  els.progressCancel.addEventListener('click', () => hideProgress());

  // ===================================================================
  //  IA
  // ===================================================================
  els.btnProcess.addEventListener('click', async () => {
    if (!state.originalCanvas) return;
    const modelKey = els.modelSelect.value;
    els.btnProcess.disabled = true;
    els.processStatus.textContent = `Preparando ${modelKey}...`;
    const t0 = performance.now();
    setStatus('Procesando...');
    await acquireWakeLock();
    try {
      let modelBuffer = null, fromCache = false;
      try {
        const cached = await ModelDB.getModel(modelKey);
        if (cached) {
          if (cached instanceof ArrayBuffer) modelBuffer = cached;
          else if (cached instanceof Blob) modelBuffer = await cached.arrayBuffer();
          else if (cached && typeof cached.arrayBuffer === 'function') modelBuffer = await cached.arrayBuffer();
          else if (cached && cached.buffer instanceof ArrayBuffer) modelBuffer = cached.buffer;
          if (modelBuffer) fromCache = true;
        }
      } catch (e) { console.warn('No se pudo leer caché:', e); }
      if (!modelBuffer) {
        const urls = MODEL_SOURCES[modelKey];
        if (!urls || !urls.length) throw new Error('Modelo desconocido: ' + modelKey);
        showProgress(`Descargando ${modelKey}...`);
        setStatus('Descargando modelo...');
        let lastError = null;
        for (let i = 0; i < urls.length; i++) {
          try {
            els.progressTitle.textContent = `Descargando ${modelKey}... (fuente ${i + 1}/${urls.length})`;
            const res = await callWorker('download', { url: urls[i] }, (p) => updateProgress(p.percent));
            modelBuffer = res.arrayBuffer; lastError = null; break;
          } catch (err) { console.warn('[download] Falló:', err.message); lastError = err; }
        }
        hideProgress();
        if (!modelBuffer) throw new Error('No se pudo descargar el modelo. ' + (lastError ? lastError.message : ''));
        setStatus('Guardando modelo...');
        try {
          await ModelDB.saveModel(modelKey, modelBuffer, { key: modelKey, label: modelKey, size: modelBuffer.byteLength, date: Date.now() });
        } catch (saveErr) { console.warn(saveErr); }
      }
      if (fromCache) setStatus('Modelo cargado desde caché');
      setStatus('Ejecutando IA...');
      els.processStatus.textContent = 'Inferencia...';
      const imageBitmap = await createImageBitmap(state.originalCanvas);
      const modelBufferCopy = modelBuffer.slice(0);
      const result = await callWorker('run', { modelBuffer: modelBufferCopy, imageBitmap });
      applyMaskResult(result.mask, result.width, result.height);
      applyMaskToCurrent();
      if (state.maskEditorActive) render();
      pushMaskHistory();
      const dt = ((performance.now() - t0) / 1000).toFixed(2);
      setStatus(`Fondo removido en ${dt} s`);
      els.processStatus.textContent = `Completado (${dt} s)`;
    } catch (err) {
      console.error('Error:', err);
      hideProgress();
      setStatus('Error: ' + err.message);
      els.processStatus.textContent = 'Error';
      alert('Error al procesar:\n\n' + err.message + '\n\nSe aplicará el modo demo heurístico como respaldo.');
      heuristicSegmentation();
      applyMaskToCurrent();
      if (state.maskEditorActive) render();
      pushMaskHistory();
    } finally {
      await releaseWakeLock();
      els.btnProcess.disabled = false;
      updateUI();
    }
  });
  function applyMaskResult(maskArray, mw, mh) {
    const small = createCanvas(mw, mh);
    const sctx = small.getContext('2d');
    const sImg = sctx.createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) {
      const v = maskArray[i];
      sImg.data[i*4] = 255; sImg.data[i*4+1] = 255;
      sImg.data[i*4+2] = 255; sImg.data[i*4+3] = v;
    }
    sctx.putImageData(sImg, 0, 0);
    const w = state.maskCanvas.width, h = state.maskCanvas.height;
    const mctx = state.maskCanvas.getContext('2d');
    mctx.globalCompositeOperation = 'source-over';
    mctx.clearRect(0, 0, w, h);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(small, 0, 0, w, h);
  }
  function heuristicSegmentation() {
    const w = state.originalCanvas.width, h = state.originalCanvas.height;
    const data = state.originalCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    let br = 0, bg = 0, bb = 0, n = 0;
    for (let x = 0; x < w; x++) {
      const top = x * 4, bot = ((h - 1) * w + x) * 4;
      br += data[top]; bg += data[top+1]; bb += data[top+2]; n++;
      br += data[bot]; bg += data[bot+1]; bb += data[bot+2]; n++;
    }
    for (let y = 0; y < h; y++) {
      const left = (y * w) * 4, right = (y * w + w - 1) * 4;
      br += data[left]; bg += data[left+1]; bb += data[left+2]; n++;
      br += data[right]; bg += data[right+1]; bb += data[right+2]; n++;
    }
    br /= n; bg /= n; bb /= n;
    const mctx = state.maskCanvas.getContext('2d');
    const mImg = mctx.getImageData(0, 0, w, h);
    const mData = mImg.data;
    const tol = 60;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const dr = data[i] - br, dg = data[i+1] - bg, db = data[i+2] - bb;
      const dist = Math.sqrt(dr*dr + dg*dg + db*db);
      if (dist < tol) { mData[i]=0; mData[i+1]=0; mData[i+2]=0; mData[i+3]=0; }
      else { mData[i]=255; mData[i+1]=255; mData[i+2]=255; mData[i+3]=255; }
    }
    mctx.putImageData(mImg, 0, 0);
  }

  // ===================================================================
  //  ATAJOS DE TECLADO
  // ===================================================================
  document.addEventListener('keydown', (e) => {
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (isInput && !e.ctrlKey && !e.metaKey) return;
    if (e.code === 'Space' && !isInput) {
      state.spacePressed = true;
      els.canvasArea.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      switch (e.key.toLowerCase()) {
        case 'o': e.preventDefault(); els.fileInput.click(); return;
        case 's': e.preventDefault(); if (!els.btnSave.disabled) els.btnSave.click(); return;
        case 'c':
          if (!els.btnCopy.disabled && !window.getSelection().toString()) {
            e.preventDefault(); els.btnCopy.click();
          }
          return;
        case 'z': e.preventDefault(); undo(); return;
        case 'y': e.preventDefault(); redo(); return;
      }
      return;
    }
    switch (e.key) {
      case '+': case '=':
        e.preventDefault();
        if (state.originalImage) {
          const area = els.canvasArea.getBoundingClientRect();
          zoomAtPoint(state.zoom * 1.2, area.width / 2, area.height / 2);
        }
        return;
      case '-': case '_':
        e.preventDefault();
        if (state.originalImage) {
          const area = els.canvasArea.getBoundingClientRect();
          zoomAtPoint(state.zoom / 1.2, area.width / 2, area.height / 2);
        }
        return;
      case '0': e.preventDefault(); if (state.originalImage) fitToView(); return;
      case '1': e.preventDefault(); if (state.originalImage) zoomTo(100); return;
      case '[':
        e.preventDefault();
        state.brushSize = clamp(state.brushSize - 5, 1, 100);
        els.brushSize.value = state.brushSize;
        els.brushSizeVal.textContent = state.brushSize;
        return;
      case ']':
        e.preventDefault();
        state.brushSize = clamp(state.brushSize + 5, 1, 100);
        els.brushSize.value = state.brushSize;
        els.brushSizeVal.textContent = state.brushSize;
        return;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { state.spacePressed = false; els.canvasArea.style.cursor = ''; }
  });

  // ===================================================================
  //  PWA / DRAG-DROP / PASTE
  // ===================================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn(err));
    });
  }
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadImageFile(file);
  });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) loadImageFile(f);
      }
    }
  });

  // ===================================================================
  //  SHARE TARGET
  // ===================================================================
  (async function initShareTarget() {
    try {
      if (navigator.serviceWorker && !navigator.serviceWorker.controller) {
        await new Promise(r => setTimeout(r, 800));
      }
      const params = new URLSearchParams(location.search);
      if (params.get('shared') === '1') {
        const reg = await navigator.serviceWorker.ready;
        const files = await new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (ev) => resolve(ev.data);
          reg.active.postMessage({ type: 'get-shared-files' }, [channel.port2]);
        });
        if (files && files.length) {
          const file = files[0];
          const blob = new Blob([file.buffer], { type: file.type || 'image/png' });
          const f = new File([blob], file.name || 'imagen-compartida.png', { type: blob.type });
          loadImageFile(f);
          history.replaceState({}, '', location.pathname);
          setStatus('Imagen recibida desde otra app');
        }
      }
    } catch (e) { console.warn('Share Target init falló:', e); }
  })();

  // ===================================================================
  //  FILE HANDLING
  // ===================================================================
  (async function initFileHandling() {
    try {
      if (!('launchQueue' in window)) return;
      window.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files || !launchParams.files.length) return;
        const handle = launchParams.files[0];
        const file = await handle.getFile();
        loadImageFile(file);
      });
    } catch (e) { console.warn('File Handling init falló:', e); }
  })();

  // ===================================================================
  //  INIT
  // ===================================================================
  els.brushSizeVal.textContent = els.brushSize.value;
  els.smartColorVal.textContent = els.smartColor.value;
  els.smartEdgeVal.textContent = els.smartEdge.value;
  els.toleranceVal.textContent = els.tolerance.value;
  els.edgeVal.textContent = els.edge.value;
  els.smoothVal.textContent = els.smooth.value;
  els.fillOpacityVal.textContent = els.fillOpacity.value;
  els.blurAmountVal.textContent = els.blurAmount.value;
  els.blurDarkVal.textContent = els.blurDark.value;
  state.brushSize = parseInt(els.brushSize.value);
  state.fill.color = els.fillColor.value;
  state.fill.opacity = parseInt(els.fillOpacity.value);
  state.blur.amount = parseInt(els.blurAmount.value);
  state.blur.darken = parseInt(els.blurDark.value);

  syncBgSectionWithCurrentTheme();
  applyCanvasBg();

  ModelDB.requestPersistence().then(granted => {
    console.log('[ModelDB] Persistencia:', granted ? 'concedida' : 'no concedida');
  });

    // ===================================================================
  //  BACKEND DE IA
  //  Forzamos WASM (CPU) en Android para evitar contención con el compositor
  //  de Chrome. En escritorio seguimos usando WebGPU si está disponible.
  // ===================================================================
  (async () => {
    if (IS_ANDROID) {
      console.log('[backend] Android detectado → usando WASM (CPU) para IA');
      worker.postMessage({ type: 'force-wasm' });
      return;
    }
    try {
      if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          worker.postMessage({ type: 'enable-webgpu' });
          console.log('[WebGPU] Adaptador disponible');
        } else {
          console.log('[backend] Sin adaptador WebGPU → usando WASM');
        }
      } else {
        console.log('[backend] WebGPU no soportado → usando WASM');
      }
    } catch (e) {
      console.warn('[backend] WebGPU no disponible:', e);
    }
  })();
  

  updateUI();
  updateFillUI();
  updateBlurUI();
  updateUndoRedoUI();
  setStatus('Listo para comenzar');

})();