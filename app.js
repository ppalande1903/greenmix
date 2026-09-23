/**
 * Greenmix: Closed-Loop Digital Restoration System
 * Web client — cavity segmentation, depth modelling, shrinkage-compensated
 * dispensing plan, guided layering, and post-op photo comparison.
 *
 * All image analysis runs at a "working resolution" (longest side ≤ WORK_MAX_DIM)
 * so large clinical photos stay responsive. Every pixel coordinate and the
 * px/mm scale in `state` refer to that working resolution.
 */

const WORK_MAX_DIM = 900;
const FLASH_THICKNESS_MM = 0.15;   // assumed feather-edge thickness of margin flash
const FLASH_BAND_MM = 2.0;         // how far outside the margin we look for flash
const POSTOP_CHANGE_THRESHOLD = 32; // RGB distance separating "changed" from "unchanged"
const FEEDBACK_BETA = 0.5;         // damping of the adaptive k update
const EXTRUDE_FILL_SECONDS = 3;    // holding the dispenser fills any planned layer in about this long
const STORAGE_KEY = "greenmix.session.v2";

// Application State
const state = {
  activeTab: 'tab-scan',
  scale_px_per_mm: 32.5,
  referenceLengthMm: 10.5,
  sensitivity: 1.0,
  maxDepthHintMm: 2.5,
  activeTool: 'calibrate',
  currentCase: 'user_case_1',
  showContour: true,
  showDepthTint: false,
  feedbackFactor: 1.0,
  kHistory: [],
  coronalSlicePct: 50,
  soundEnabled: true,
  lofiPlaying: false,
  diffView: 'diff',
  caseId: '',

  // Working-resolution images
  imageWidth: 800,
  imageHeight: 800,
  workCanvas: null,
  preData: null,
  postWorkCanvas: null,
  preBlur: null,
  postBlur: null,
  postopImage: null,
  postAlign: { dx: 0, dy: 0 },

  // Segmentation
  scores: null,
  threshold: 0,
  maxScore: 0,
  seedPoint: null,
  cavityMask: null,
  boundary: null,
  bbox: null,
  depthMap: null,
  probe: null,

  // Ruler
  rulerStart: null,
  rulerEnd: null,
  dragHandle: null,

  // Database & selection
  materials: [],
  selectedMaterial: null,

  metrics: null,
  morphology: null,
  dispensePlan: null,
  evaluation: null,

  guided: { layerIdx: 0, dispensedMg: 0, cured: [], curing: false }
};

// Embedded fallback when materials_data.json cannot be fetched (e.g. file://)
const DEFAULT_MATERIALS = [
  { id: "3m_filtek_supreme_ultra", brand: "3M Oral Care", name: "Filtek Supreme Ultra", category: "Universal Nanocomposite", filler_weight_percent: 78.5, filler_volume_percent: 63.3, density_g_per_cm3: 2.10, volumetric_shrinkage_percent: 1.90, max_increment_depth_mm: 2.0, light_cure_time_sec: 10, color_code: "#0284c7" },
  { id: "3m_filtek_one_bulk_fill", brand: "3M Oral Care", name: "Filtek One Bulk Fill", category: "Posterior Bulk Fill", filler_weight_percent: 76.5, filler_volume_percent: 58.4, density_g_per_cm3: 2.05, volumetric_shrinkage_percent: 1.50, max_increment_depth_mm: 4.5, light_cure_time_sec: 20, color_code: "#059669" },
  { id: "kerr_harmonize", brand: "Kerr Dental", name: "Harmonize", category: "Universal Nanohybrid", filler_weight_percent: 81.0, filler_volume_percent: 64.5, density_g_per_cm3: 2.12, volumetric_shrinkage_percent: 2.10, max_increment_depth_mm: 2.0, light_cure_time_sec: 20, color_code: "#8b5cf6" },
  { id: "ivoclar_tetric_prime", brand: "Ivoclar Vivadent", name: "Tetric Prime", category: "Universal Composite", filler_weight_percent: 79.0, filler_volume_percent: 61.0, density_g_per_cm3: 2.08, volumetric_shrinkage_percent: 2.00, max_increment_depth_mm: 2.0, light_cure_time_sec: 10, color_code: "#f59e0b" },
  { id: "dentsply_sdr_flow_plus", brand: "Dentsply Sirona", name: "SDR flow+", category: "Bulk Fill Flowable Base", filler_weight_percent: 68.0, filler_volume_percent: 45.0, density_g_per_cm3: 1.88, volumetric_shrinkage_percent: 3.00, max_increment_depth_mm: 4.0, light_cure_time_sec: 20, color_code: "#14b8a6" },
  { id: "tokuyama_estelite_sigma_quick", brand: "Tokuyama Dental", name: "Estelite Sigma Quick", category: "Submicron Spherical Composite", filler_weight_percent: 82.0, filler_volume_percent: 71.0, density_g_per_cm3: 1.96, volumetric_shrinkage_percent: 1.90, max_increment_depth_mm: 2.0, light_cure_time_sec: 10, color_code: "#e11d48" }
];

// Clinical sample cases. Scale and ruler coordinates are in the image's native pixels.
const CASES = {
  user_case_1: {
    title: "Patient Molar (Your Photo 1)",
    preop_src: "samples/user_cavity_1.jpg",
    postop_src: "samples/user_cavity_1_restored.jpg",
    default_scale: 32.5,
    depth_hint: 2.5,
    ref_length_mm: 10.5,
    ruler: [{ x: 25, y: 220 }, { x: 345, y: 220 }],
    tooth_name: "Mandibular First Molar (#36)"
  },
  user_case_2: {
    title: "Molar Prep (Your Photo 2)",
    preop_src: "samples/user_cavity_2.jpg",
    postop_src: "samples/user_cavity_2_restored.jpg",
    default_scale: 65.0,
    depth_hint: 2.2,
    ref_length_mm: 10.5,
    ruler: [{ x: 45, y: 400 }, { x: 705, y: 400 }],
    tooth_name: "Mandibular Molar Typodont (#46)"
  },
  case_1: {
    title: "Class I Molar (Benchmark)",
    preop_src: "samples/case_1_class_1_molar_cavity.png",
    postop_src: "samples/case_1_class_1_molar_restored.png",
    default_scale: 50.0,
    depth_hint: 2.8,
    ref_length_mm: 5.0,
    ruler: [{ x: 60, y: 70 }, { x: 310, y: 70 }],
    tooth_name: "Mandibular First Molar (#36)"
  },
  case_2: {
    title: "Class II MO Premolar (Benchmark)",
    preop_src: "samples/case_2_class_2_premolar_cavity.png",
    postop_src: "samples/case_2_class_2_premolar_restored.png",
    default_scale: 50.0,
    depth_hint: 3.5,
    ref_length_mm: 5.0,
    ruler: [{ x: 60, y: 70 }, { x: 310, y: 70 }],
    tooth_name: "Maxillary First Premolar (#24)"
  }
};

const $ = (id) => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* -------------------------------------------------------------
 * WEB AUDIO API SYNTHESIZER
 * ------------------------------------------------------------- */
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone({ type = 'sine', from, to, ramp = 'exp', dur, vol, at = 0 }) {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to) {
      if (ramp === 'exp') osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      else osc.frequency.linearRampToValueAtTime(to, t0 + dur);
    }
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch (e) {}
}

// Mechanical keyboard click
function playClickSound(pitch = 800) {
  playTone({ type: 'triangle', from: pitch, to: 120, dur: 0.04, vol: 0.2 });
}

// Squishy resin extrusion
function playSquishSound() {
  playTone({ from: 300, to: 150, ramp: 'lin', dur: 0.12, vol: 0.18 });
}

// Curing light hum (470 Hz, matching the 470 nm peak)
function playCureHumSound() {
  playTone({ type: 'sawtooth', from: 470, dur: 0.5, vol: 0.06 });
}

function playSuccessChime() {
  [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
    playTone({ from: freq, dur: 0.3, vol: 0.16, at: i * 0.08 });
  });
}

function playWarnSound() {
  playTone({ type: 'square', from: 330, to: 220, ramp: 'lin', dur: 0.18, vol: 0.06 });
}

// Lo-fi pentatonic arpeggio
let lofiInterval = null;
function setLoFi(playing) {
  state.lofiPlaying = playing;
  document.querySelector(".sound-bars")?.classList.toggle("playing", playing);
  $("lofi-player-btn")?.classList.toggle("active", playing);
  if (lofiInterval) { clearInterval(lofiInterval); lofiInterval = null; }
  if (!playing) return;
  const chord = [261.63, 329.63, 392.00, 440.00, 523.25];
  let noteIdx = 0;
  lofiInterval = setInterval(() => {
    playTone({ from: chord[noteIdx++ % chord.length], dur: 0.6, vol: 0.04 });
  }, 600);
}

/* -------------------------------------------------------------
 * TOASTS
 * ------------------------------------------------------------- */
function toast(message, kind = 'info', ms = 3800) {
  const host = $("toast-host");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/* -------------------------------------------------------------
 * PERSISTENCE (per-browser convenience only)
 * ------------------------------------------------------------- */
function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return null;
    if (typeof saved.soundEnabled === 'boolean') state.soundEnabled = saved.soundEnabled;
    if (Number.isFinite(saved.feedbackFactor)) state.feedbackFactor = saved.feedbackFactor;
    if (Array.isArray(saved.kHistory)) state.kHistory = saved.kHistory.slice(-20);
    return saved;
  } catch (e) {
    return null;
  }
}

function saveSession() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      soundEnabled: state.soundEnabled,
      feedbackFactor: state.feedbackFactor,
      kHistory: state.kHistory,
      materialId: state.selectedMaterial?.id
    }));
  } catch (e) {}
}

/* -------------------------------------------------------------
 * INITIALIZATION & EVENTS
 * ------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  const saved = loadSession();
  startClock();
  setupTabs();
  setupEventListeners();
  syncSoundButton();
  await loadMaterials(saved?.materialId);
  initThreeJS();
  loadClinicalCase('user_case_1');
});

function startClock() {
  function updateTime() {
    const d = new Date();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    setText("mac-clock", `${hours}:${minutes} ${ampm}`);
  }
  updateTime();
  setInterval(updateTime, 10000);
}

const TAB_ORDER = ['tab-scan', 'tab-3d', 'tab-dispense', 'tab-closed-loop', 'tab-report'];

function setupTabs() {
  document.querySelectorAll(".retro-tab, .menu-link").forEach(btn => {
    btn.addEventListener("click", () => {
      playClickSound(950);
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  $("btn-goto-dispense")?.addEventListener("click", () => { playClickSound(1000); switchTab("tab-dispense"); });
  $("btn-goto-closed-loop")?.addEventListener("click", () => { playClickSound(1000); switchTab("tab-closed-loop"); });
  $("btn-quick-report")?.addEventListener("click", () => { playClickSound(900); switchTab("tab-report"); });

  // Keyboard: 1–5 switch steps, unless typing in a field
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TAB_ORDER.length) {
      playClickSound(950);
      switchTab(TAB_ORDER[n - 1]);
    }
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll(".retro-tab, .menu-link").forEach(b => {
    const on = b.getAttribute("data-tab") === tabId;
    b.classList.toggle("active", on);
    if (b.classList.contains("retro-tab")) b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-content").forEach(content => {
    content.classList.toggle("active", content.id === tabId);
  });

  if (tabId === 'tab-3d') {
    onResizeThree();
    renderProfileCrossSection();
  } else if (tabId === 'tab-closed-loop') {
    renderPostopCanvas();
  } else if (tabId === 'tab-report') {
    updateClinicalReport();
  }
}

async function loadMaterials(preferredId) {
  try {
    const res = await fetch("materials_data.json");
    state.materials = res.ok ? ((await res.json()).materials || DEFAULT_MATERIALS) : DEFAULT_MATERIALS;
  } catch (e) {
    state.materials = DEFAULT_MATERIALS;
  }

  const select = $("select-material");
  if (!select) return;
  select.innerHTML = "";
  state.materials.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.brand} - ${m.name} (${m.category})`;
    select.appendChild(opt);
  });

  state.selectedMaterial = state.materials.find(m => m.id === preferredId) || state.materials[0];
  select.value = state.selectedMaterial.id;
  updateMaterialUI();
}

function selectMaterial(id) {
  const mat = state.materials.find(m => m.id === id);
  if (!mat || mat === state.selectedMaterial) return;
  state.selectedMaterial = mat;
  const select = $("select-material");
  if (select) select.value = id;
  updateMaterialUI();
  computeDispensingPlan();
  saveSession();
}

function syncSoundButton() {
  const btn = $("btn-toggle-sound");
  btn?.classList.toggle("sound-active", state.soundEnabled);
  btn?.setAttribute("aria-pressed", state.soundEnabled ? "true" : "false");
  setText("sound-icon", state.soundEnabled ? "🔊" : "🔇");
  setText("sound-label", state.soundEnabled ? "sound: ON" : "sound: OFF");
}

function setupEventListeners() {
  document.querySelectorAll(".case-card-fun").forEach(btn => {
    btn.addEventListener("click", () => {
      playClickSound(1100);
      loadClinicalCase(btn.getAttribute("data-case"));
    });
  });

  $("btn-toggle-sound")?.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    syncSoundButton();
    if (!state.soundEnabled) setLoFi(false);
    else playClickSound(1200);
    saveSession();
  });

  $("lofi-player-btn")?.addEventListener("click", () => {
    if (!state.soundEnabled) {
      toast("Sound is off — turn it on in the menu bar first.");
      return;
    }
    setLoFi(!state.lofiPlaying);
  });

  // Scanner tools
  const tools = {
    calibrate: { btn: $("tool-calibrate"), hint: `Mode: <strong>Scale Calibration</strong> — drag across a known length, or drag an end handle to adjust` },
    inspect: { btn: $("tool-inspect"), hint: `Mode: <strong>Depth Probe</strong> — hover over the cavity to read modelled depth` },
    pick: { btn: $("tool-pick"), hint: `Mode: <strong>Pick Cavity</strong> — click inside the cavity if auto-detection chose the wrong region` }
  };
  Object.entries(tools).forEach(([name, t]) => {
    t.btn?.addEventListener("click", () => {
      playClickSound();
      state.activeTool = name;
      Object.values(tools).forEach(o => o.btn?.classList.toggle("active", o === t));
      $("calibration-tooltip").innerHTML = `<span>${t.hint}</span>`;
      state.probe = null;
      renderCavityCanvas();
    });
  });

  $("btn-toggle-overlay")?.addEventListener("click", (e) => {
    playClickSound();
    state.showContour = !state.showContour;
    e.currentTarget.classList.toggle("active", state.showContour);
    renderCavityCanvas();
  });

  $("btn-toggle-depth-tint")?.addEventListener("click", (e) => {
    playClickSound();
    state.showDepthTint = !state.showDepthTint;
    e.currentTarget.classList.toggle("active", state.showDepthTint);
    renderCavityCanvas();
  });

  $("btn-reset-zoom")?.addEventListener("click", () => {
    playClickSound();
    if (state.currentCase === 'custom') {
      state.seedPoint = null;
      resetDefaultRuler();
      scheduleRecompute();
    } else {
      loadClinicalCase(state.currentCase);
    }
    toast("Calibration and segmentation reset.");
  });

  $("slider-sensitivity")?.addEventListener("input", (e) => {
    state.sensitivity = parseFloat(e.target.value);
    setText("val-sensitivity", `${state.sensitivity.toFixed(2)}x`);
    scheduleRecompute();
  });

  $("input-depth-hint")?.addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    state.maxDepthHintMm = clamp(v, 0.5, 8.0);
    scheduleRecompute();
  });

  $("input-marker-length")?.addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < 0.5) return;
    state.referenceLengthMm = v;
    const lenPx = rulerLengthPx();
    if (lenPx > 10) {
      state.scale_px_per_mm = lenPx / state.referenceLengthMm;
      updateScaleDisplay();
      scheduleRecompute();
    } else {
      renderCavityCanvas();
    }
  });

  $("select-material")?.addEventListener("change", (e) => {
    playClickSound(850);
    selectMaterial(e.target.value);
  });

  $("slider-slice")?.addEventListener("input", (e) => {
    state.coronalSlicePct = parseInt(e.target.value, 10);
    setText("val-slice-depth", `${state.coronalSlicePct}%`);
    renderProfileCrossSection();
    updateThreeSlicePlane();
  });

  setupCanvasInteractions();
  setupFileUploads();
  setupGuidedPlacement();

  document.querySelectorAll("[data-diff-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      playClickSound();
      state.diffView = btn.getAttribute("data-diff-view");
      renderPostopCanvas();
    });
  });

  $("btn-auto-align")?.addEventListener("click", () => {
    playClickSound();
    autoAlignPostop();
  });

  $("btn-apply-calibration")?.addEventListener("click", () => {
    const ev = state.evaluation;
    if (!ev) {
      toast("Load a post-op photo first — there is nothing to learn from yet.", 'warn');
      return;
    }
    playSuccessChime();
    const prev = state.feedbackFactor;
    state.feedbackFactor = ev.recommended_next_feedback_factor;
    state.kHistory.push({ at: new Date().toISOString(), from: prev, to: state.feedbackFactor, deviation_percent: ev.deviation_percent });
    state.kHistory = state.kHistory.slice(-20);
    saveSession();
    computeDispensingPlan();
    toast(`Dispensing model updated: k ${prev.toFixed(3)} → ${state.feedbackFactor.toFixed(3)}`, 'success');
  });

  $("btn-reset-calibration")?.addEventListener("click", () => {
    playClickSound();
    state.feedbackFactor = 1.0;
    state.kHistory = [];
    saveSession();
    computeDispensingPlan();
    toast("Calibration factor reset to k = 1.000.");
  });

  $("btn-export-json")?.addEventListener("click", exportJSON);
  $("btn-export-json-hero")?.addEventListener("click", exportJSON);
  $("btn-print-report")?.addEventListener("click", () => { updateClinicalReport(); window.print(); });

  window.addEventListener("resize", () => {
    ["cavity-canvas", "postop-canvas"].forEach(id => { const c = $(id); if (c) fitCanvasToViewport(c); });
    if (state.activeTab === 'tab-3d') {
      onResizeThree();
      renderProfileCrossSection();
    }
  });
}

/* -------------------------------------------------------------
 * CLINICAL CASE & IMAGE LOADING
 * ------------------------------------------------------------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Draws an image into a canvas of the working size. Returns { canvas, factor }.
function toWorkingCanvas(img, w, h) {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  let factor = 1;
  if (!w || !h) {
    factor = Math.min(1, WORK_MAX_DIM / Math.max(nw, nh));
    w = Math.round(nw * factor);
    h = Math.round(nh * factor);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
  return { canvas, factor };
}

function newCaseId() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `GM-${ymd}-${rand}`;
}

function setActiveCaseCard(caseKey) {
  document.querySelectorAll(".case-card-fun").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-case") === caseKey);
  });
}

let caseLoadToken = 0;

async function loadClinicalCase(caseKey) {
  const caseData = CASES[caseKey];
  if (!caseData) return;
  const token = ++caseLoadToken;
  setBusy(true);

  let pre, post;
  try {
    [pre, post] = await Promise.all([
      loadImage(caseData.preop_src),
      loadImage(caseData.postop_src).catch(() => null)
    ]);
  } catch (e) {
    setBusy(false);
    toast(`${e.message}. Serve the folder over HTTP (e.g. python3 -m http.server).`, 'error', 6000);
    return;
  }
  if (token !== caseLoadToken) return;

  state.currentCase = caseKey;
  state.caseId = newCaseId();
  setActiveCaseCard(caseKey);
  $("input-tooth").value = caseData.tooth_name;

  const { factor } = setPreopImage(pre);
  state.scale_px_per_mm = caseData.default_scale * factor;
  state.maxDepthHintMm = caseData.depth_hint;
  state.referenceLengthMm = caseData.ref_length_mm;
  state.rulerStart = { x: caseData.ruler[0].x * factor, y: caseData.ruler[0].y * factor };
  state.rulerEnd = { x: caseData.ruler[1].x * factor, y: caseData.ruler[1].y * factor };
  $("input-depth-hint").value = state.maxDepthHintMm;
  $("input-marker-length").value = state.referenceLengthMm;
  updateScaleDisplay();

  setPostopImage(post);
  recomputeCavityAnalysis();
  setBusy(false);
}

function setPreopImage(img) {
  const { canvas, factor } = toWorkingCanvas(img);
  state.workCanvas = canvas;
  state.imageWidth = canvas.width;
  state.imageHeight = canvas.height;
  state.preData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  state.preBlur = null;
  state.seedPoint = null;
  state.probe = null;
  resetSensitivity();
  return { factor };
}

function setPostopImage(img) {
  state.postopImage = img;
  state.postAlign = { dx: 0, dy: 0 };
  state.postWorkCanvas = null;
  state.evaluation = null;
  if (img) buildPostopWorkCanvas();
}

function buildPostopWorkCanvas() {
  if (!state.postopImage) return;
  const w = state.imageWidth, h = state.imageHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Post-op photos are assumed to share the pre-op framing; stretch to match, then apply alignment offset.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(state.postopImage, state.postAlign.dx, state.postAlign.dy, w, h);
  state.postWorkCanvas = canvas;
  state.postBlur = null;
}

function resetSensitivity() {
  state.sensitivity = 1.0;
  const s = $("slider-sensitivity");
  if (s) s.value = "1.0";
  setText("val-sensitivity", "1.00x");
}

function resetDefaultRuler() {
  const w = state.imageWidth, h = state.imageHeight;
  state.rulerStart = { x: w * 0.1, y: h * 0.9 };
  state.rulerEnd = { x: w * 0.9, y: h * 0.9 };
  state.scale_px_per_mm = rulerLengthPx() / state.referenceLengthMm;
  updateScaleDisplay();
}

function setupFileUploads() {
  const accept = (file) => file && file.type.startsWith("image/");

  $("cavity-file-input")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleUserImageFile(f, 'preop');
    e.target.value = "";
  });
  $("postop-file-input")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleUserImageFile(f, 'postop');
    e.target.value = "";
  });

  // Drag & drop: pre-op on the dropzone or scanner viewport, post-op on the comparator viewport
  const dropTargets = [
    [$("cavity-dropzone"), 'preop'],
    [$("viewport-container"), 'preop'],
    [$("postop-viewport"), 'postop']
  ];
  dropTargets.forEach(([el, type]) => {
    if (!el) return;
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const f = e.dataTransfer?.files?.[0];
      if (accept(f)) handleUserImageFile(f, type);
      else toast("That doesn't look like an image file.", 'warn');
    });
  });

  // Paste an image from the clipboard: goes to post-op when on the QA tab, pre-op otherwise
  document.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (!item) return;
    handleUserImageFile(item.getAsFile(), state.activeTab === 'tab-closed-loop' ? 'postop' : 'preop');
  });
}

async function handleUserImageFile(file, type) {
  const url = URL.createObjectURL(file);
  let img;
  try {
    img = await loadImage(url);
  } catch (e) {
    toast("Couldn't read that image.", 'error');
    return;
  } finally {
    URL.revokeObjectURL(url);
  }

  if (type === 'preop') {
    caseLoadToken++;
    state.currentCase = 'custom';
    state.caseId = newCaseId();
    setActiveCaseCard(null);
    $("input-tooth").value = "";
    setPreopImage(img);
    resetDefaultRuler();
    setPostopImage(null);
    recomputeCavityAnalysis();
    switchTab('tab-scan');
    toast("Photo loaded. Drag the green ruler across a feature of known length, then enter that length.", 'info', 6000);
  } else {
    if (!state.workCanvas) {
      toast("Load a pre-op cavity photo first.", 'warn');
      return;
    }
    setPostopImage(img);
    const ratioPre = state.imageWidth / state.imageHeight;
    const ratioPost = img.naturalWidth / img.naturalHeight;
    if (Math.abs(ratioPre - ratioPost) > 0.03) {
      toast("Post-op photo has a different aspect ratio — it was stretched to match. Try Auto-Align.", 'warn', 6000);
    }
    renderPostopCanvas();
    toast("Post-op photo loaded and compared.", 'success');
  }
}

function setBusy(busy) {
  setText("probe-status", busy ? "probe: analysing…" : "probe: ready");
  document.querySelector(".status-pill")?.classList.toggle("busy", busy);
}

/* -------------------------------------------------------------
 * COMPUTER VISION & GEOMETRY ESTIMATION PIPELINE
 * ------------------------------------------------------------- */
let recomputeQueued = false;
function scheduleRecompute() {
  if (recomputeQueued) return;
  recomputeQueued = true;
  requestAnimationFrame(() => {
    recomputeQueued = false;
    recomputeCavityAnalysis();
  });
}

// "Cavity-likeness": prepared dentin/caries is darker and warmer (R ≫ B) than enamel.
// Weighted toward the image centre, where clinical photos frame the tooth.
function computeCavityScores(data, w, h) {
  const scores = new Float32Array(w * h);
  const cx = w / 2, cy = h / 2;
  const rx = w * 0.45, ry = h * 0.45;
  let maxScore = 0;
  for (let y = 0; y < h; y++) {
    const ny = (y - cy) / ry;
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rx;
      const dCenter = Math.sqrt(nx * nx + ny * ny);
      if (dCenter > 0.85) continue;
      const idx = y * w + x;
      const p = idx * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      const centerWeight = clamp(1.3 - dCenter, 0, 1);
      const score = ((r - b) * 0.8 + (255 - gray) * 0.6) * centerWeight;
      scores[idx] = score;
      if (dCenter < 0.6 && score > maxScore) maxScore = score;
    }
  }
  return { scores, maxScore };
}

// Labels the connected component (4-connectivity) containing `start`; returns its pixel indices.
function floodComponent(candidate, visited, w, h, start, queue) {
  let head = 0, tail = 0;
  queue[tail++] = start;
  visited[start] = 1;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0 && candidate[i - 1] && !visited[i - 1]) { visited[i - 1] = 1; queue[tail++] = i - 1; }
    if (x < w - 1 && candidate[i + 1] && !visited[i + 1]) { visited[i + 1] = 1; queue[tail++] = i + 1; }
    if (i >= w && candidate[i - w] && !visited[i - w]) { visited[i - w] = 1; queue[tail++] = i - w; }
    if (i < w * (h - 1) && candidate[i + w] && !visited[i + w]) { visited[i + w] = 1; queue[tail++] = i + w; }
  }
  return queue.slice(0, tail);
}

// Keeps a single cavity region: the component under the user's seed if set, else the largest.
function selectCavityComponent(candidate, w, h, seedIdx) {
  const n = w * h;
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let best = null;

  if (seedIdx != null && candidate[seedIdx]) {
    best = floodComponent(candidate, visited, w, h, seedIdx, queue);
  } else {
    for (let i = 0; i < n; i++) {
      if (!candidate[i] || visited[i]) continue;
      const comp = floodComponent(candidate, visited, w, h, i, queue);
      if (!best || comp.length > best.length) best = comp;
    }
  }

  const mask = new Uint8Array(n);
  if (best) for (let k = 0; k < best.length; k++) mask[best[k]] = 1;
  return mask;
}

// Fills enclosed holes (specular highlights, debris) inside the cavity outline.
function fillHoles(mask, w, h) {
  const n = w * h;
  const outside = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let head = 0;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  for (let i = 0; i < n; i++) if (!outside[i]) mask[i] = 1;
  return mask;
}

function recomputeCavityAnalysis() {
  if (!state.workCanvas) return;

  const w = state.imageWidth;
  const h = state.imageHeight;
  const data = state.preData;
  const scale = state.scale_px_per_mm;

  const { scores, maxScore } = computeCavityScores(data, w, h);
  const threshold = maxScore * (0.62 / state.sensitivity);
  state.scores = scores;
  state.maxScore = maxScore;
  state.threshold = threshold;

  const candidate = new Uint8Array(w * h);
  for (let i = 0; i < candidate.length; i++) candidate[i] = scores[i] > threshold ? 1 : 0;

  let seedIdx = null;
  if (state.seedPoint) {
    seedIdx = Math.floor(state.seedPoint.y) * w + Math.floor(state.seedPoint.x);
    if (!candidate[seedIdx]) {
      toast("No cavity-like pixels at the picked point with this sensitivity — using the largest region.", 'warn');
      state.seedPoint = null;
      seedIdx = null;
    }
  }
  const mask = fillHoles(selectCavityComponent(candidate, w, h, seedIdx), w, h);
  state.cavityMask = mask;

  // Depth model: a smooth bowl from the margin (distance transform), scaled so the
  // deepest point matches the clinician's probe depth, lightly modulated by shading.
  const distMap = computeDistanceTransform(mask, w, h);
  let maxDist = 0;
  for (let i = 0; i < distMap.length; i++) if (mask[i] && distMap[i] > maxDist) maxDist = distMap[i];
  if (maxDist === 0) maxDist = 1;

  const probeDepth = state.maxDepthHintMm;
  const depthMap = new Float32Array(w * h);
  const areaPerPx = 1 / (scale * scale);
  let volume = 0, count = 0, maxZ = 0;
  let sumX = 0, sumY = 0;
  let minX = w, maxX = -1, minY = h, maxY = -1;

  let maxRaw = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const normDist = Math.min(1, distMap[i] / (maxDist * 0.70));
    const p = i * 4;
    const lum = (data[p] + data[p + 1] + data[p + 2]) / 3;
    const raw = (1 - Math.exp(-3.2 * normDist)) * (1 + 0.12 * (1 - lum / 255));
    depthMap[i] = raw;
    if (raw > maxRaw) maxRaw = raw;
  }
  const depthScale = maxRaw > 0 ? probeDepth / maxRaw : 0;

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const z = depthMap[i] * depthScale;
    depthMap[i] = z;
    volume += z * areaPerPx;
    if (z > maxZ) maxZ = z;
    count++;
    const x = i % w, y = (i - x) / w;
    sumX += x; sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  state.depthMap = depthMap;

  if (count === 0) {
    state.bbox = null;
    state.boundary = new Int32Array(0);
    state.metrics = { length_mm: 0, width_mm: 0, opening_area_mm2: 0, perimeter_mm: 0, max_depth_mm: 0, mean_depth_mm: 0, volume_mm3: 0, c_factor: 0 };
    state.morphology = null;
    toast("No cavity detected — try raising Contour Sensitivity or use Pick Cavity.", 'warn');
  } else {
    state.bbox = { minX, maxX, minY, maxY };
    const geo = measureOutline(mask, w, h, sumX / count, sumY / count, count);
    const area = count * areaPerPx;
    const perimeter = geo.perimeterPx / scale;
    const meanDepth = volume / area;
    // C-factor = bonded / unbonded surface. Floor ≈ opening area; walls ≈ perimeter × mean depth.
    const cFactor = (area + perimeter * meanDepth) / area;

    state.metrics = {
      length_mm: geo.longPx / scale,
      width_mm: geo.shortPx / scale,
      opening_area_mm2: area,
      perimeter_mm: perimeter,
      max_depth_mm: maxZ,
      mean_depth_mm: meanDepth,
      volume_mm3: volume,
      c_factor: cFactor
    };
    state.morphology = {
      aspect_ratio: geo.longPx / Math.max(1, geo.shortPx),
      compactness: (4 * Math.PI * area) / Math.max(1e-6, perimeter * perimeter),
      solidity: count / Math.max(1, geo.hullAreaPx),
      axis_angle_deg: geo.angleDeg
    };
  }

  updateMetricsUI();
  renderCavityCanvas();
  computeDispensingPlan();
  updateThreeMesh();
  renderProfileCrossSection();
}

// Principal-axis extents, boundary perimeter and convex hull of the mask.
function measureOutline(mask, w, h, meanX, meanY, count) {
  let sxx = 0, syy = 0, sxy = 0;
  const boundary = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i - x) / w;
    const dx = x - meanX, dy = y - meanY;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
      boundary.push(i);
    }
  }
  sxx /= count; syy /= count; sxy /= count;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta), uy = Math.sin(theta);

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const pts = [];
  for (const i of boundary) {
    const x = i % w, y = (i - x) / w;
    const u = (x - meanX) * ux + (y - meanY) * uy;
    const v = -(x - meanX) * uy + (y - meanY) * ux;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    pts.push([x, y]);
  }
  state.boundary = Int32Array.from(boundary);

  // Boundary pixel count under-counts diagonal runs; ~1.05 corrects typical rounded outlines.
  const perimeterPx = boundary.length * 1.05;

  return {
    longPx: maxU - minU + 1,
    shortPx: maxV - minV + 1,
    angleDeg: theta * 180 / Math.PI,
    perimeterPx,
    hullAreaPx: convexHullArea(pts)
  };
}

function convexHullArea(points) {
  if (points.length < 3) return points.length;
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// Two-pass chamfer distance transform: distance (px) from each mask pixel to the nearest non-mask pixel.
function computeDistanceTransform(mask, w, h) {
  const dist = new Float32Array(w * h);
  const INF = 1e6;
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? INF : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (dist[idx] === 0) continue;
      if (x === 0 || y === 0 || x === w - 1) { dist[idx] = 1; continue; }
      dist[idx] = Math.min(dist[idx], dist[idx - 1] + 1, dist[idx - w] + 1,
        dist[idx - w - 1] + 1.414, dist[idx - w + 1] + 1.414);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x;
      if (dist[idx] === 0) continue;
      if (x === w - 1 || y === h - 1 || x === 0) { dist[idx] = Math.min(dist[idx], 1); continue; }
      dist[idx] = Math.min(dist[idx], dist[idx + 1] + 1, dist[idx + w] + 1,
        dist[idx + w + 1] + 1.414, dist[idx + w - 1] + 1.414);
    }
  }
  return dist;
}

function invertMask(mask) {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  return inv;
}

/* -------------------------------------------------------------
 * CANVAS RENDERING (2D CAVITY & OVERLAYS)
 * ------------------------------------------------------------- */
function renderCavityCanvas() {
  const canvas = $("cavity-canvas");
  if (!canvas || !state.workCanvas) return;

  const w = state.imageWidth;
  const h = state.imageHeight;
  canvas.width = w;
  canvas.height = h;
  fitCanvasToViewport(canvas);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(state.workCanvas, 0, 0);

  if (state.showDepthTint && state.depthMap) {
    const tint = ctx.createImageData(w, h);
    const td = tint.data;
    const maxD = state.metrics?.max_depth_mm || 3;
    for (let i = 0; i < state.depthMap.length; i++) {
      const z = state.depthMap[i];
      if (z <= 0.05) continue;
      const [r, g, b] = depthColor(z / maxD);
      const p = i * 4;
      td[p] = r; td[p + 1] = g; td[p + 2] = b; td[p + 3] = 150;
    }
    drawImageData(ctx, tint, w, h);
  }

  if (state.showContour && state.boundary) {
    ctx.fillStyle = "#00f0ff";
    ctx.shadowColor = "rgba(0, 240, 255, 0.85)";
    ctx.shadowBlur = 6;
    const b = state.boundary;
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      const x = i % w;
      ctx.fillRect(x - 0.5, (i - x) / w - 0.5, 2, 2);
    }
    ctx.shadowBlur = 0;
  }

  if (state.seedPoint) {
    const { x, y } = state.seedPoint;
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13);
    ctx.stroke();
  }

  if (state.rulerStart && state.rulerEnd) drawRuler(ctx);

  if (state.activeTool === 'inspect' && state.probe) {
    const { x, y, depth } = state.probe;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
    const label = depth > 0 ? `${depth.toFixed(2)} mm` : "outside";
    ctx.font = "bold 12px JetBrains Mono, monospace";
    const tw = ctx.measureText(label).width + 12;
    const lx = Math.min(w - tw - 4, x + 12), ly = Math.max(4, y - 28);
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.fillRect(lx, ly, tw, 20);
    ctx.fillStyle = "#34d399";
    ctx.textAlign = "left";
    ctx.fillText(label, lx + 6, ly + 14);
  }
}

// Scales a canvas's CSS box to fill its viewport while keeping the image aspect ratio.
function fitCanvasToViewport(canvas) {
  const box = canvas.parentElement;
  if (!box || !box.clientWidth) return;
  const s = Math.min(box.clientWidth / canvas.width, box.clientHeight / canvas.height);
  canvas.style.width = `${Math.floor(canvas.width * s)}px`;
  canvas.style.height = `${Math.floor(canvas.height * s)}px`;
}

function drawImageData(ctx, imageData, w, h) {
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d").putImageData(imageData, 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

// Blue → green → amber → rose ramp used by the 2D tint, 3D mesh and legend.
function depthColor(t) {
  const stops = [[2, 132, 199], [16, 185, 129], [245, 158, 11], [225, 29, 72]];
  const pos = [0, 0.4, 0.75, 1];
  t = clamp(t, 0, 1);
  let k = 0;
  while (k < pos.length - 2 && t > pos[k + 1]) k++;
  const f = (t - pos[k]) / (pos[k + 1] - pos[k]);
  return stops[k].map((c, j) => Math.round(c + (stops[k + 1][j] - c) * f));
}

function rulerLengthPx() {
  if (!state.rulerStart || !state.rulerEnd) return 0;
  return Math.hypot(state.rulerEnd.x - state.rulerStart.x, state.rulerEnd.y - state.rulerStart.y);
}

function drawRuler(ctx) {
  const p1 = state.rulerStart, p2 = state.rulerEnd;
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  drawRulerCap(ctx, p1, p2);
  drawRulerCap(ctx, p2, p1);

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const label = `${state.referenceLengthMm.toFixed(1)} mm (${rulerLengthPx().toFixed(0)} px)`;
  ctx.font = "bold 11px JetBrains Mono, monospace";
  const tw = ctx.measureText(label).width + 16;
  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.fillRect(midX - tw / 2, midY - 28, tw, 22);
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(midX - tw / 2, midY - 28, tw, 22);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(label, midX, midY - 13);
}

function drawRulerCap(ctx, pt, other) {
  const dx = other.x - pt.x;
  const dy = other.y - pt.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * 9;
  const ny = dx / len * 9;
  ctx.beginPath();
  ctx.moveTo(pt.x + nx, pt.y + ny);
  ctx.lineTo(pt.x - nx, pt.y - ny);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function updateScaleDisplay() {
  setText("val-scale-display", `${state.scale_px_per_mm.toFixed(1)} px/mm`);
}

function setupCanvasInteractions() {
  const canvas = $("cavity-canvas");
  if (!canvas) return;

  const toCanvas = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
      pxPerCss: sx
    };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.workCanvas) return;
    const pt = toCanvas(e);
    const p = { x: pt.x, y: pt.y };

    if (state.activeTool === 'calibrate') {
      canvas.setPointerCapture(e.pointerId);
      const grab = 16 * pt.pxPerCss;
      if (state.rulerStart && Math.hypot(p.x - state.rulerStart.x, p.y - state.rulerStart.y) < grab) {
        state.dragHandle = 'start';
      } else if (state.rulerEnd && Math.hypot(p.x - state.rulerEnd.x, p.y - state.rulerEnd.y) < grab) {
        state.dragHandle = 'end';
      } else {
        state.rulerStart = p;
        state.rulerEnd = { ...p };
        state.dragHandle = 'end';
      }
      playClickSound(750);
      renderCavityCanvas();
    } else if (state.activeTool === 'pick') {
      playClickSound(1000);
      state.seedPoint = p;
      recomputeCavityAnalysis();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.workCanvas) return;
    const pt = toCanvas(e);
    const p = { x: clamp(pt.x, 0, state.imageWidth - 1), y: clamp(pt.y, 0, state.imageHeight - 1) };

    if (state.dragHandle && state.activeTool === 'calibrate') {
      if (state.dragHandle === 'start') state.rulerStart = p;
      else state.rulerEnd = p;
      const lenPx = rulerLengthPx();
      if (lenPx > 10) {
        state.scale_px_per_mm = lenPx / state.referenceLengthMm;
        updateScaleDisplay();
      }
      renderCavityCanvas();
    } else if (state.activeTool === 'inspect' && state.depthMap) {
      const depth = state.depthMap[Math.floor(p.y) * state.imageWidth + Math.floor(p.x)] || 0;
      state.probe = { x: p.x, y: p.y, depth };
      setText("val-probe-depth", `${depth.toFixed(2)} mm`);
      renderCavityCanvas();
    }
  });

  const endDrag = () => {
    if (!state.dragHandle) return;
    state.dragHandle = null;
    playClickSound(900);
    if (rulerLengthPx() <= 10) {
      toast("Ruler too short — drag across a longer known distance.", 'warn');
    }
    recomputeCavityAnalysis();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (state.activeTool === 'inspect' && state.probe) {
      state.probe = null;
      renderCavityCanvas();
    }
  });
}

function updateMetricsUI() {
  const m = state.metrics;
  if (!m) return;
  setText("metric-volume", m.volume_mm3.toFixed(1));
  setText("metric-max-depth", m.max_depth_mm.toFixed(1));
  setText("metric-length", m.length_mm.toFixed(1));
  setText("metric-width", m.width_mm.toFixed(1));
  setText("metric-area", m.opening_area_mm2.toFixed(1));
  setText("metric-c-factor", m.c_factor.toFixed(1));
  setText("metric-c-factor-label", cFactorLabel(m.c_factor));
  setText("cfactor-advisory", m.c_factor.toFixed(1));

  setText("legend-max-depth", `${m.max_depth_mm.toFixed(1)} mm (floor)`);
  setText("legend-mid-depth", `${(m.max_depth_mm / 2).toFixed(1)} mm`);
  setText("chip-scan", `${m.volume_mm3.toFixed(1)} mm³`);

  updateMorphologyUI();
}

function cFactorLabel(c) {
  if (c >= 3) return "High stress";
  if (c >= 2) return "Moderate";
  return "Low stress";
}

function updateMorphologyUI() {
  const m = state.metrics, mo = state.morphology;
  if (!mo) {
    ["morph-aspect", "morph-perimeter", "morph-compact", "morph-solidity", "morph-depth"].forEach(id => setText(id, "—"));
    return;
  }
  setText("morph-aspect", `${mo.aspect_ratio.toFixed(2)} : 1`);
  setText("morph-perimeter", `${m.perimeter_mm.toFixed(1)} mm`);
  setText("morph-compact", `${mo.compactness.toFixed(2)} ${mo.compactness > 0.7 ? '(rounded)' : mo.compactness > 0.45 ? '(elongated)' : '(complex)'}`);
  setText("morph-solidity", `${(mo.solidity * 100).toFixed(0)}% ${mo.solidity > 0.9 ? '(convex)' : '(isthmus / extensions)'}`);
  setText("morph-depth", `${m.mean_depth_mm.toFixed(2)} / ${m.max_depth_mm.toFixed(2)} mm`);
}

function updateMaterialUI() {
  const mat = state.selectedMaterial;
  if (!mat) return;
  setText("mat-category", mat.category);
  setText("mat-title", `${mat.brand} ${mat.name}`);
  setText("mat-density", `${mat.density_g_per_cm3.toFixed(2)} g/cm³`);
  setText("mat-shrinkage", `${mat.volumetric_shrinkage_percent.toFixed(2)}%`);
  setText("mat-max-layer", `${mat.max_increment_depth_mm.toFixed(1)} mm`);
  setText("mat-filler", `${mat.filler_weight_percent.toFixed(1)} wt%`);
}

/* -------------------------------------------------------------
 * COMPOSITE DISPENSING & INCREMENTAL LAYERING ENGINE
 * ------------------------------------------------------------- */

// Volume (mm³) of cavity lying in each elevation band measured up from the deepest point.
function bandVolumes(bands) {
  const mask = state.cavityMask, depth = state.depthMap;
  const maxD = state.metrics.max_depth_mm;
  const areaPerPx = 1 / (state.scale_px_per_mm ** 2);
  const vols = new Array(bands.length).fill(0);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const floor = maxD - depth[i];
    for (let k = 0; k < bands.length; k++) {
      const [a, b] = bands[k];
      const t = Math.min(b, maxD) - Math.max(a, floor);
      if (t > 0) vols[k] += t * areaPerPx;
    }
  }
  return vols;
}

// `detailed` integrates per-layer volumes over the depth map; the comparison table only needs totals.
function planFor(mat, detailed = true) {
  const m = state.metrics;
  const vNet = m.volume_mm3;
  const maxDepth = m.max_depth_mm;
  // Higher C-factor → more contraction stress at bonded walls → slightly more compensation.
  const alpha = 1 + 0.05 * Math.max(0, m.c_factor - 1);
  const compRatio = (mat.volumetric_shrinkage_percent / 100) * alpha;
  const k = state.feedbackFactor;
  const vTarget = vNet * (1 + compRatio) * k;
  const density = mat.density_g_per_cm3;
  const massMg = vTarget * density;

  // Layer thickness schedule (bottom-up)
  const maxInc = mat.max_increment_depth_mm;
  const schedule = [];
  if (maxDepth <= maxInc) {
    schedule.push({ t: maxDepth, name: "Bulk Placement Increment", tech: "Single anatomical increment; adapt to margins, then cure.", role: 'bulk' });
  } else {
    const liner = Math.min(1.0, maxDepth * 0.3);
    schedule.push({ t: liner, name: "Pulpal Floor Base", tech: "Thin first layer to seal the floor and avoid internal voids.", role: 'base' });
    const rem = maxDepth - liner;
    const bodyCount = Math.ceil(rem / maxInc - 1e-9);
    for (let i = 0; i < bodyCount; i++) {
      const last = i === bodyCount - 1;
      schedule.push({
        t: rem / bodyCount,
        name: last ? "Occlusal Enamel Cap" : `Dentin Oblique Increment ${i + 1}`,
        tech: last ? "Sculpt cusp slopes and primary grooves before curing." : "Oblique wedge against one wall at a time to reduce C-factor stress.",
        role: last ? 'cap' : 'body'
      });
    }
  }

  let z = 0;
  const bands = schedule.map(s => { const band = [z, z + s.t]; z += s.t; return band; });
  const vols = vNet > 0 && detailed ? bandVolumes(bands) : bands.map(() => 0);
  const toTarget = vNet > 0 ? vTarget / vNet : 0;
  const palette = { base: "#00b4d8", body: "#0284c7", cap: "#38bdf8", bulk: mat.color_code || "#0284c7" };

  const layers = schedule.map((s, i) => {
    const vol = vols[i] * toTarget;
    return {
      num: i + 1,
      name: s.name,
      thickness: s.t,
      vol,
      mass: vol * density,
      cure: mat.light_cure_time_sec,
      tech: s.tech,
      color: s.role === 'body' && i % 2 === 0 ? "#10b981" : palette[s.role]
    };
  });

  return { material_id: mat.id, alpha, compRatio, feedbackFactor: k, vNet, vCompensated: vTarget, massMg, massG: massMg / 1000, layers };
}

function computeDispensingPlan() {
  const mat = state.selectedMaterial;
  if (!mat || !state.metrics || !state.cavityMask) return;

  const plan = planFor(mat);
  state.dispensePlan = plan;
  const { vNet, vCompensated, massMg, massG, compRatio } = plan;
  const extraVol = vNet * (1 + compRatio) - vNet;

  setText("calc-net-vol", `${vNet.toFixed(2)} mm³`);
  setText("calc-comp-label", `2. Shrinkage comp. (S×α = ${(compRatio * 100).toFixed(2)}%):`);
  setText("calc-comp-vol", `+${extraVol.toFixed(2)} mm³`);
  setText("calc-k-vol", `× ${state.feedbackFactor.toFixed(3)}`);
  setText("calc-target-vol", `${vCompensated.toFixed(2)} mm³ (µL)`);
  setText("calc-mass-mg", `${massMg.toFixed(1)} mg (${massG.toFixed(4)} g)`);

  setText("val-compule-frac", `${(massG / 0.25).toFixed(2)} × 0.25 g compule`);
  setText("val-syringe-turns", `${(vCompensated / 28.27).toFixed(2)} turns @ 28.3 µL/turn`);
  setText("val-micro-steps", `${Math.round(vCompensated * 2)} steps @ 0.5 µL/step`);
  setText("chip-dispense", `${massMg.toFixed(1)} mg`);

  resetGuided();
  renderLayeringSchematic(plan.layers);
  renderMaterialComparison();
  renderProfileCrossSection();
  renderPostopCanvas(); // re-evaluates QA against the new plan so status, waste and tab chip stay current
}

function renderLayeringSchematic(layers) {
  const tbody = $("layers-tbody");
  if (!tbody) return;
  setText("layer-badge-info", `${layers.length} ${layers.length === 1 ? 'Increment' : 'Increments'} Planned`);

  tbody.innerHTML = "";
  layers.forEach((l, i) => {
    const tr = document.createElement("tr");
    tr.dataset.layer = i;
    tr.innerHTML = `
      <td><span class="layer-swatch" style="background:${l.color}"></span><strong>${l.num}</strong></td>
      <td>${l.name}</td>
      <td>${l.thickness.toFixed(1)} mm</td>
      <td>${l.vol.toFixed(1)} mm³</td>
      <td>${l.mass.toFixed(1)} mg</td>
      <td>${l.cure}s</td>
      <td>${l.tech}</td>
    `;
    tbody.appendChild(tr);
  });
  renderGuided();
}

function renderMaterialComparison() {
  const tbody = $("compare-tbody");
  if (!tbody || !state.metrics) return;
  tbody.innerHTML = "";
  const rows = state.materials.map(mat => ({ mat, plan: planFor(mat, false) }));
  const minMass = Math.min(...rows.map(r => r.plan.massMg));
  rows.forEach(({ mat, plan }) => {
    const tr = document.createElement("tr");
    tr.className = mat === state.selectedMaterial ? "selected" : "";
    tr.tabIndex = 0;
    const totalCure = plan.layers.reduce((s, l) => s + l.cure, 0);
    tr.innerHTML = `
      <td><span class="layer-swatch" style="background:${mat.color_code || '#94a3b8'}"></span>${mat.name}</td>
      <td>${mat.volumetric_shrinkage_percent.toFixed(1)}%</td>
      <td>${plan.massMg.toFixed(1)}${plan.massMg === minMass ? ' <span class="best-tag">least</span>' : ''}</td>
      <td>${plan.layers.length}</td>
      <td>${totalCure}s</td>
    `;
    const choose = () => { playClickSound(850); selectMaterial(mat.id); };
    tr.addEventListener("click", choose);
    tr.addEventListener("keydown", (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    tbody.appendChild(tr);
  });
}

/* -------------------------------------------------------------
 * GUIDED PLACEMENT (hold-to-extrude + curing timer per layer)
 * ------------------------------------------------------------- */
let extrudeTimer = null;
let cureTimer = null;

function resetGuided() {
  stopExtrude();
  if (cureTimer) { clearInterval(cureTimer); cureTimer = null; }
  $("actinic-beam-overlay")?.classList.remove("firing");
  state.guided = { layerIdx: 0, dispensedMg: 0, cured: [], curing: false };
}

function setupGuidedPlacement() {
  const btn = $("btn-extrude-drop");
  if (btn) {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); startExtrude(); });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => btn.addEventListener(ev, stopExtrude));
    btn.addEventListener("keydown", (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startExtrude(); } });
    btn.addEventListener("keyup", (e) => { if (e.key === ' ' || e.key === 'Enter') stopExtrude(); });
  }
  $("btn-cure-layer")?.addEventListener("click", startCure);
  $("btn-guided-restart")?.addEventListener("click", () => {
    playClickSound();
    resetGuided();
    renderGuided();
  });
}

function currentLayer() {
  return state.dispensePlan?.layers[state.guided.layerIdx] || null;
}

function startExtrude() {
  const layer = currentLayer();
  if (!layer || state.guided.curing || extrudeTimer) return;
  playSquishSound();
  let ticks = 0;
  let last = performance.now();
  const rateMgPerS = clamp(layer.mass / EXTRUDE_FILL_SECONDS, 1, 40);
  extrudeTimer = setInterval(() => {
    const now = performance.now();
    state.guided.dispensedMg += rateMgPerS * (now - last) / 1000; // elapsed-time based, robust to timer throttling
    last = now;
    if (++ticks % 4 === 0) playSquishSound();
    renderGuided();
  }, 50);
}

function stopExtrude() {
  if (!extrudeTimer) return;
  clearInterval(extrudeTimer);
  extrudeTimer = null;
  const layer = currentLayer();
  if (layer && state.guided.dispensedMg > layer.mass * 1.1) {
    toast(`Over-dispensed by ${(state.guided.dispensedMg - layer.mass).toFixed(1)} mg — excess becomes flash to finish off.`, 'warn');
  }
}

function startCure() {
  const layer = currentLayer();
  if (!layer || state.guided.curing) return;
  stopExtrude();
  state.guided.curing = true;
  const total = layer.cure;
  let left = total;
  const overlay = $("actinic-beam-overlay");
  setText("cure-timer-display", `${total.toFixed(1)}s`);
  const progress = $("cure-progress-fill");
  if (progress) progress.style.width = "0%";
  overlay?.classList.add("firing");
  playCureHumSound();
  renderGuided();

  cureTimer = setInterval(() => {
    left = Math.max(0, left - 0.1);
    setText("cure-timer-display", `${left.toFixed(1)}s`);
    const fill = $("cure-progress-fill");
    if (fill) fill.style.width = `${((total - left) / total) * 100}%`;
    if (Math.round(left * 10) % 20 === 0 && left > 0.5) playCureHumSound();

    if (left <= 0) {
      clearInterval(cureTimer);
      cureTimer = null;
      overlay?.classList.remove("firing");
      const g = state.guided;
      g.cured.push({ layer: layer.num, planned_mg: layer.mass, dispensed_mg: g.dispensedMg });
      g.curing = false;
      g.layerIdx++;
      g.dispensedMg = 0;
      playSuccessChime();
      const done = g.layerIdx >= state.dispensePlan.layers.length;
      toast(done ? "All increments placed and cured. Photograph the result for closed-loop QA." : `Layer ${layer.num} cured.`, 'success');
      renderGuided();
    }
  }, 100);
}

function renderGuided() {
  const plan = state.dispensePlan;
  const well = $("cavity-well");
  if (!plan || !well) return;
  const g = state.guided;
  const layer = currentLayer();
  const done = !layer;

  // Schematic: cured layers solid, current layer fills as material is extruded, pending layers ghosted
  well.innerHTML = "";
  plan.layers.forEach((l, i) => {
    const bar = document.createElement("div");
    bar.className = "layer-bar";
    bar.style.flex = String(Math.max(0.2, l.thickness));
    bar.style.setProperty("--layer-color", l.color);
    let fillPct = 0;
    if (i < g.layerIdx) { bar.classList.add("cured"); fillPct = 100; }
    else if (i === g.layerIdx) { bar.classList.add("current"); fillPct = Math.min(100, (g.dispensedMg / Math.max(0.01, l.mass)) * 100); }
    else bar.classList.add("pending");
    bar.style.setProperty("--fill", `${fillPct}%`);
    bar.innerHTML = `<span>${i < g.layerIdx ? '✓ ' : ''}#${l.num} ${l.name}</span><span>${l.thickness.toFixed(1)} mm · ${l.mass.toFixed(1)} mg</span>`;
    well.appendChild(bar);
  });

  document.querySelectorAll("#layers-tbody tr").forEach(tr => {
    const i = Number(tr.dataset.layer);
    tr.classList.toggle("row-current", i === g.layerIdx);
    tr.classList.toggle("row-cured", i < g.layerIdx);
  });

  const extrudeBtn = $("btn-extrude-drop");
  const cureBtn = $("btn-cure-layer");
  if (done) {
    setText("guided-step", `All ${plan.layers.length} increments cured`);
    setText("guided-detail", `Dispensed ${g.cured.reduce((s, c) => s + c.dispensed_mg, 0).toFixed(1)} mg vs. ${plan.massMg.toFixed(1)} mg planned.`);
    setText("guided-progress-label", "Complete");
    $("guided-progress-fill").style.width = "100%";
    $("guided-progress-fill").className = "guided-progress-fill ok";
    if (extrudeBtn) extrudeBtn.disabled = true;
    if (cureBtn) cureBtn.disabled = true;
    return;
  }

  const pct = (g.dispensedMg / Math.max(0.01, layer.mass)) * 100;
  setText("guided-step", `Layer ${layer.num} of ${plan.layers.length} · ${layer.name}`);
  setText("guided-detail", layer.tech);
  setText("guided-progress-label", `${g.dispensedMg.toFixed(1)} / ${layer.mass.toFixed(1)} mg`);
  const fill = $("guided-progress-fill");
  fill.style.width = `${Math.min(100, pct)}%`;
  fill.className = `guided-progress-fill ${pct > 110 ? 'over' : pct >= 90 ? 'ok' : ''}`;
  if (extrudeBtn) extrudeBtn.disabled = g.curing;
  if (cureBtn) {
    cureBtn.disabled = g.curing || pct < 90;
    cureBtn.textContent = g.curing ? "Curing…" : `⚡ Cure ${layer.cure}s`;
  }
}

/* -------------------------------------------------------------
 * THREE.JS 3D CAVITY TOPOGRAPHY
 * ------------------------------------------------------------- */
let threeScene, threeCamera, threeRenderer, threeMesh, threeControls, threeSlice;
let threeExtent = { w: 10, h: 10, d: 3 };

function initThreeJS() {
  const container = $("three-container");
  if (!container || threeRenderer) return;
  if (!window.THREE) {
    container.insertAdjacentHTML("beforeend", `<div class="viewport-empty">3D view unavailable — Three.js failed to load (offline?).</div>`);
    return;
  }

  const w = container.clientWidth || 600;
  const h = container.clientHeight || 600;

  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x0a0f1d);

  threeCamera = new THREE.PerspectiveCamera(40, w / h, 0.1, 1000);
  threeCamera.up.set(0, 0, 1); // z is depth; OrbitControls reads `up` at construction
  threeRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  threeRenderer.setSize(w, h);
  threeRenderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(threeRenderer.domElement);

  if (THREE.OrbitControls) {
    threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.08;
  }

  threeScene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xe0fbff, 0.65);
  key.position.set(15, 20, 30);
  threeScene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-20, -15, 20);
  threeScene.add(fill);

  $("btn-3d-wireframe")?.addEventListener("click", (e) => {
    playClickSound();
    if (!threeMesh) return;
    threeMesh.material.wireframe = !threeMesh.material.wireframe;
    e.currentTarget.classList.toggle("active", threeMesh.material.wireframe);
  });

  $("btn-3d-reset-cam")?.addEventListener("click", () => {
    playClickSound();
    resetThreeCamera();
  });

  resetThreeCamera();
  animateThree();
}

function resetThreeCamera() {
  if (!threeCamera) return;
  const span = Math.max(threeExtent.w, threeExtent.h);
  threeCamera.position.set(0, -span * 1.1, span * 1.25);
  threeControls?.target.set(0, 0, -threeExtent.d * 0.4);
  threeControls?.update();
  threeCamera.lookAt(0, 0, -threeExtent.d * 0.4);
}

function onResizeThree() {
  const container = $("three-container");
  if (!container || !threeRenderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  threeCamera.aspect = w / h;
  threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(w, h);
}

function animateThree() {
  requestAnimationFrame(animateThree);
  if (state.activeTab !== 'tab-3d') return; // no GPU work while hidden
  threeControls?.update();
  threeRenderer.render(threeScene, threeCamera);
}

// Cropped around the cavity (with a margin of surrounding enamel), in true millimetres.
function sliceRange() {
  const b = state.bbox;
  if (!b) return null;
  const padX = Math.round((b.maxX - b.minX) * 0.25) + 8;
  const padY = Math.round((b.maxY - b.minY) * 0.25) + 8;
  return {
    x0: Math.max(0, b.minX - padX), x1: Math.min(state.imageWidth - 1, b.maxX + padX),
    y0: Math.max(0, b.minY - padY), y1: Math.min(state.imageHeight - 1, b.maxY + padY)
  };
}

function updateThreeMesh() {
  if (!threeScene || !state.depthMap) return;
  if (threeMesh) {
    threeScene.remove(threeMesh);
    threeMesh.geometry.dispose();
    threeMesh.material.dispose();
    threeMesh = null;
  }
  const r = sliceRange();
  if (!r) return;

  const scale = state.scale_px_per_mm;
  const wMm = (r.x1 - r.x0) / scale;
  const hMm = (r.y1 - r.y0) / scale;
  const maxD = state.metrics.max_depth_mm || 1;
  threeExtent = { w: wMm, h: hMm, d: maxD };

  const res = 140;
  const gridW = Math.max(8, Math.round(res * Math.min(1, wMm / hMm)));
  const gridH = Math.max(8, Math.round(res * Math.min(1, hMm / wMm)));
  const geom = new THREE.PlaneGeometry(wMm, hMm, gridW - 1, gridH - 1);
  const pos = geom.attributes.position;
  const colors = new Float32Array(gridW * gridH * 3);
  const w = state.imageWidth;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const v = gy * gridW + gx;
      const imgX = Math.round(r.x0 + (gx / (gridW - 1)) * (r.x1 - r.x0));
      const imgY = Math.round(r.y0 + (gy / (gridH - 1)) * (r.y1 - r.y0));
      const z = state.depthMap[imgY * w + imgX] || 0;
      pos.setZ(v, -z);
      let rgb;
      if (z < 0.05) {
        // surrounding enamel keeps its photo colour
        const p = (imgY * w + imgX) * 4;
        rgb = [state.preData[p], state.preData[p + 1], state.preData[p + 2]];
      } else {
        rgb = depthColor(z / maxD);
      }
      colors[v * 3] = rgb[0] / 255;
      colors[v * 3 + 1] = rgb[1] / 255;
      colors[v * 3 + 2] = rgb[2] / 255;
    }
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
  threeMesh = new THREE.Mesh(geom, mat);
  threeScene.add(threeMesh);

  updateThreeSlicePlane();
  resetThreeCamera();
}

function updateThreeSlicePlane() {
  if (!threeScene) return;
  if (!threeSlice) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    threeSlice = new THREE.Mesh(g, m);
    threeSlice.rotation.x = Math.PI / 2;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x00f0ff }));
    threeSlice.add(edge);
    threeScene.add(threeSlice);
  }
  const { w, h, d } = threeExtent;
  threeSlice.scale.set(w, d * 1.6, 1);
  // Plane geometry spans +h/2 (top row, gy=0) to -h/2; slice % runs top → bottom
  threeSlice.position.set(0, h / 2 - (state.coronalSlicePct / 100) * h, -d * 0.6);
}

/* -------------------------------------------------------------
 * 2D CROSS-SECTION PROFILE CANVAS
 * ------------------------------------------------------------- */
function renderProfileCrossSection() {
  const canvas = $("profile-canvas");
  if (!canvas || !state.depthMap || state.activeTab !== 'tab-3d') return;
  const r = sliceRange();

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 360;
  const cssH = 170;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, cssW, cssH);
  if (!r) return;

  const padL = 34, padR = 8, padT = 14, padB = 22;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
  const maxD = state.metrics.max_depth_mm || 1;
  const yMax = Math.ceil(maxD * 1.15 * 2) / 2;
  const scale = state.scale_px_per_mm;
  const widthMm = (r.x1 - r.x0) / scale;
  const X = (mm) => padL + (mm / widthMm) * plotW;
  const Y = (d) => padT + (d / yMax) * plotH;

  // Grid + axes labels
  ctx.font = "10px JetBrains Mono, monospace";
  ctx.fillStyle = "#94a3b8";
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  for (let d = 0; d <= yMax + 1e-6; d += yMax > 3 ? 1 : 0.5) {
    ctx.beginPath(); ctx.moveTo(padL, Y(d)); ctx.lineTo(cssW - padR, Y(d)); ctx.stroke();
    ctx.fillText(`${d}`, padL - 5, Y(d) + 3);
  }
  ctx.textAlign = "center";
  const stepMm = widthMm > 12 ? 2 : 1;
  for (let mm = 0; mm <= widthMm + 1e-6; mm += stepMm) {
    ctx.beginPath(); ctx.moveTo(X(mm), padT); ctx.lineTo(X(mm), padT + plotH); ctx.stroke();
    ctx.fillText(`${mm}`, X(mm), cssH - 7);
  }
  ctx.save();
  ctx.translate(10, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("depth mm", 0, 0);
  ctx.restore();

  const sliceY = Math.round(r.y0 + (state.coronalSlicePct / 100) * (r.y1 - r.y0));
  const w = state.imageWidth;
  const samples = [];
  for (let px = r.x0; px <= r.x1; px++) samples.push((state.depthMap[sliceY * w + px] || 0));
  const xAt = (k) => X(k / scale);

  // Planned composite layers, drawn as bands from the floor up
  const plan = state.dispensePlan;
  if (plan) {
    let elev = 0;
    plan.layers.forEach(l => {
      const top = maxD - (elev + l.thickness), bot = maxD - elev;
      ctx.fillStyle = hexToRgba(l.color, 0.55);
      ctx.beginPath();
      samples.forEach((d, k) => {
        const yTop = Y(Math.min(d, Math.max(0, top)));
        if (k === 0) ctx.moveTo(xAt(k), yTop); else ctx.lineTo(xAt(k), yTop);
      });
      for (let k = samples.length - 1; k >= 0; k--) ctx.lineTo(xAt(k), Y(Math.min(samples[k], bot)));
      ctx.closePath();
      ctx.fill();
      elev += l.thickness;
    });
  }

  // Dentin below the cavity floor
  ctx.beginPath();
  samples.forEach((d, k) => { if (k === 0) ctx.moveTo(xAt(k), Y(d)); else ctx.lineTo(xAt(k), Y(d)); });
  ctx.lineTo(xAt(samples.length - 1), padT + plotH);
  ctx.lineTo(xAt(0), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(180, 83, 9, 0.35)";
  ctx.fill();

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach((d, k) => { if (k === 0) ctx.moveTo(xAt(k), Y(d)); else ctx.lineTo(xAt(k), Y(d)); });
  ctx.stroke();

  ctx.strokeStyle = "#00f0ff";
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(cssW - padR, Y(0)); ctx.stroke();
  ctx.setLineDash([]);

  const deepest = Math.max(...samples);
  setText("profile-caption", `Slice max depth ${deepest.toFixed(2)} mm · width ${widthMm.toFixed(1)} mm`);
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* -------------------------------------------------------------
 * CLOSED-LOOP POST-RESTORATION VERIFICATION
 * ------------------------------------------------------------- */

// 3×3 box blur on RGB channels to suppress JPEG noise before comparing photos.
function blurRGB(data, w, h) {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const p = (yy * w + xx) * 4;
          r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

// Classifies each pixel near the cavity as filled / unfilled / flash by comparing the
// post-op photo against the pre-op photo, then derives volumes, waste and the next k.
function evaluateRestoration() {
  const w = state.imageWidth, h = state.imageHeight;
  const mask = state.cavityMask;
  const plan = state.dispensePlan;
  const mat = state.selectedMaterial;
  if (!state.postWorkCanvas || !mask || !plan || !state.metrics.volume_mm3) return null;

  // Blurred copies only change when a photo or the alignment changes, so cache them
  if (!state.preBlur) state.preBlur = blurRGB(state.preData, w, h);
  if (!state.postBlur) state.postBlur = blurRGB(state.postWorkCanvas.getContext("2d").getImageData(0, 0, w, h).data, w, h);
  const pre = state.preBlur;
  const post = state.postBlur;
  const outsideDist = computeDistanceTransform(invertMask(mask), w, h);

  const scale = state.scale_px_per_mm;
  const areaPerPx = 1 / (scale * scale);
  const bandPx = FLASH_BAND_MM * scale;
  const cls = new Uint8Array(w * h); // 1 filled, 2 unfilled, 3 flash
  let filledVol = 0, unfilledVol = 0, flashPx = 0, filledPx = 0, unfilledPx = 0;

  for (let i = 0; i < mask.length; i++) {
    const o = i * 3;
    const dr = post[o] - pre[o], dg = post[o + 1] - pre[o + 1], db = post[o + 2] - pre[o + 2];
    const change = Math.sqrt(dr * dr + dg * dg + db * db);
    if (mask[i]) {
      const z = state.depthMap[i];
      if (change < POSTOP_CHANGE_THRESHOLD) {
        cls[i] = 2; unfilledVol += z * areaPerPx; unfilledPx++;
      } else {
        cls[i] = 1; filledVol += z * areaPerPx; filledPx++;
      }
    } else if (outsideDist[i] <= bandPx && change >= POSTOP_CHANGE_THRESHOLD * 1.25) {
      cls[i] = 3; flashPx++;
    }
  }

  const vNet = state.metrics.volume_mm3;
  const flashArea = flashPx * areaPerPx;
  const flashVol = flashArea * FLASH_THICKNESS_MM;
  const restoredVol = filledVol + flashVol;
  const deltaV = restoredVol - vNet;
  const devPct = (deltaV / vNet) * 100;
  const fillPct = (filledVol / vNet) * 100;

  const density = mat.density_g_per_cm3;
  const dispensedMg = plan.massMg;
  const wastedMg = flashVol * density;
  const wastePct = (wastedMg / dispensedMg) * 100;

  const k = state.feedbackFactor;
  const nextK = clamp(k * (1 - FEEDBACK_BETA * deltaV / vNet), 0.7, 1.3);

  let status;
  const under = fillPct < 92, flash = flashArea > 0.5 && flashVol / vNet > 0.02;
  if (under && flash) status = { key: 'mixed', label: 'UNDERFILL + FLASH', text: 'Underfilled with margin flash' };
  else if (under) status = { key: 'underfill', label: 'UNDERFILL ⚠', text: 'Underfilled — voids remain' };
  else if (flash) status = { key: 'flash', label: 'MARGIN FLASH ⚠', text: 'Overfill flash beyond margin' };
  else status = { key: 'optimal', label: 'OPTIMAL SEAL ✨', text: 'Optimal seal' };

  return {
    classes: cls,
    status,
    cavity_net_volume_mm3: vNet,
    filled_volume_mm3: filledVol,
    unfilled_volume_mm3: unfilledVol,
    fill_percent: fillPct,
    filled_area_mm2: filledPx * areaPerPx,
    unfilled_area_mm2: unfilledPx * areaPerPx,
    restored_volume_mm3: restoredVol,
    volumetric_deviation_mm3: deltaV,
    deviation_percent: devPct,
    flash_area_mm2: flashArea,
    flash_volume_mm3: flashVol,
    dispensed_mass_mg: dispensedMg,
    retained_mass_mg: Math.min(dispensedMg, filledVol * density),
    wasted_mass_mg: wastedMg,
    material_waste_percent: wastePct,
    current_feedback_factor: k,
    recommended_next_feedback_factor: nextK,
    alignment_px: { ...state.postAlign }
  };
}

function renderPostopCanvas() {
  const canvas = $("postop-canvas");
  if (!canvas || !state.workCanvas) return;
  const w = state.imageWidth, h = state.imageHeight;
  canvas.width = w;
  canvas.height = h;
  fitCanvasToViewport(canvas);
  const ctx = canvas.getContext("2d");

  document.querySelectorAll("[data-diff-view]").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-diff-view") === state.diffView);
  });

  const hasPost = !!state.postWorkCanvas;
  $("postop-empty")?.classList.toggle("show", !hasPost);
  $("postop-legend")?.classList.toggle("hidden", !hasPost || state.diffView !== 'diff');

  state.evaluation = hasPost ? evaluateRestoration() : null;
  updateEvaluationUI();

  if (state.diffView === 'preop' || !hasPost) {
    ctx.drawImage(state.workCanvas, 0, 0);
    return;
  }
  ctx.drawImage(state.postWorkCanvas, 0, 0);
  if (state.diffView === 'postop' || !state.evaluation) return;

  const overlay = ctx.createImageData(w, h);
  const od = overlay.data;
  const cls = state.evaluation.classes;
  const colors = { 1: [16, 185, 129, 90], 2: [239, 68, 68, 170], 3: [2, 132, 199, 170] };
  for (let i = 0; i < cls.length; i++) {
    const c = colors[cls[i]];
    if (!c) continue;
    const p = i * 4;
    od[p] = c[0]; od[p + 1] = c[1]; od[p + 2] = c[2]; od[p + 3] = c[3];
  }
  drawImageData(ctx, overlay, w, h);

  // Planned margin
  ctx.fillStyle = "#ffffff";
  const b = state.boundary;
  for (let k = 0; k < b.length; k += 2) {
    const i = b[k];
    const x = i % w;
    ctx.fillRect(x, (i - x) / w, 1.5, 1.5);
  }
}

function updateEvaluationUI() {
  const ev = state.evaluation;
  const badge = $("badge-eval-status");
  const sign = (v) => (v >= 0 ? '+' : '−');

  setText("val-k-current", state.feedbackFactor.toFixed(3));
  renderKHistory();

  if (!ev) {
    ["metric-post-vol", "metric-delta-vol", "metric-flash-area", "metric-waste-pct", "metric-fill-pct", "val-error-grad", "val-k-next"]
      .forEach(id => setText(id, "—"));
    if (badge) { badge.textContent = "AWAITING POST-OP"; badge.className = "badge-status status-pending"; }
    setText("chip-qa", "no photo");
    setText("wb-summary", "Upload or drop a post-op photo of the cured restoration to compare it against the plan.");
    $("wb-summary").className = "wb-trophy-banner tone-neutral";
    ["wb-retained", "wb-flash", "wb-missing"].forEach(id => { const el = $(id); if (el) el.style.width = "0%"; });
    return;
  }

  setText("metric-post-vol", ev.restored_volume_mm3.toFixed(1));
  setText("metric-delta-vol", `${sign(ev.volumetric_deviation_mm3)}${Math.abs(ev.volumetric_deviation_mm3).toFixed(2)} mm³ (${sign(ev.deviation_percent)}${Math.abs(ev.deviation_percent).toFixed(1)}%)`);
  setText("metric-flash-area", ev.flash_area_mm2.toFixed(2));
  setText("metric-waste-pct", `${ev.material_waste_percent.toFixed(1)}%`);
  setText("metric-fill-pct", `${ev.fill_percent.toFixed(1)}%`);
  setText("val-error-grad", `${sign(ev.deviation_percent)}${Math.abs(ev.deviation_percent / 100).toFixed(3)}`);
  setText("val-k-next", ev.recommended_next_feedback_factor.toFixed(3));
  if (badge) { badge.textContent = ev.status.label; badge.className = `badge-status status-${ev.status.key}`; }
  setText("chip-qa", ev.status.key === 'optimal' ? 'optimal' : ev.status.key);

  // Material balance: where the planned composite ended up
  const plannedVol = ev.cavity_net_volume_mm3;
  const total = Math.max(plannedVol, ev.filled_volume_mm3 + ev.unfilled_volume_mm3 + ev.flash_volume_mm3);
  $("wb-retained").style.width = `${(ev.filled_volume_mm3 / total) * 100}%`;
  $("wb-missing").style.width = `${(ev.unfilled_volume_mm3 / total) * 100}%`;
  $("wb-flash").style.width = `${(ev.flash_volume_mm3 / total) * 100}%`;
  setText("wb-retained-val", `${ev.filled_volume_mm3.toFixed(1)} mm³`);
  setText("wb-missing-val", `${ev.unfilled_volume_mm3.toFixed(1)} mm³`);
  setText("wb-flash-val", `${ev.flash_volume_mm3.toFixed(2)} mm³`);

  const msgs = {
    optimal: `${ev.fill_percent.toFixed(0)}% of the cavity volume is filled and flash is minimal — about ${ev.wasted_mass_mg.toFixed(1)} mg would be removed during finishing.`,
    underfill: `${ev.unfilled_area_mm2.toFixed(1)} mm² of the cavity floor still looks unrestored (red). Check for voids or an incomplete final increment.`,
    flash: `${ev.flash_area_mm2.toFixed(1)} mm² of composite extends past the margin (blue) — roughly ${ev.wasted_mass_mg.toFixed(1)} mg to finish off.`,
    mixed: `Unrestored areas (red) and flash beyond the margin (blue) are both present — review placement technique before adjusting k.`
  };
  setText("wb-summary", msgs[ev.status.key]);
  const tone = { optimal: '', underfill: 'tone-bad', mixed: 'tone-bad', flash: 'tone-warn' }[ev.status.key];
  $("wb-summary").className = `wb-trophy-banner ${tone}`;
}

function renderKHistory() {
  const host = $("k-history");
  if (!host) return;
  if (!state.kHistory.length) {
    host.textContent = "No calibration updates yet.";
    return;
  }
  host.innerHTML = "";
  state.kHistory.slice(-6).reverse().forEach(e => {
    const row = document.createElement("div");
    row.className = "k-row";
    const when = new Date(e.at);
    row.innerHTML = `<span>${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>${e.from.toFixed(3)} → <strong>${e.to.toFixed(3)}</strong></span>`;
    host.appendChild(row);
  });
}

// Brute-force translation search (±R px) minimising grey-level difference outside the cavity.
function autoAlignPostop() {
  if (!state.postopImage) {
    toast("Load a post-op photo first.", 'warn');
    return;
  }
  const w = state.imageWidth, h = state.imageHeight;
  // Compare against an un-shifted post-op render
  const saved = state.postAlign;
  state.postAlign = { dx: 0, dy: 0 };
  buildPostopWorkCanvas();
  const post = state.postWorkCanvas.getContext("2d").getImageData(0, 0, w, h).data;
  const pre = state.preData;
  const mask = state.cavityMask;
  const outsideDist = computeDistanceTransform(invertMask(mask), w, h);
  const exclude = FLASH_BAND_MM * state.scale_px_per_mm * 1.5;

  const gray = (d, i) => d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  const R = Math.round(Math.min(24, Math.max(w, h) * 0.03));
  const samples = [];
  const step = Math.max(3, Math.round(Math.sqrt((w * h) / 20000)));
  for (let y = R; y < h - R; y += step) {
    for (let x = R; x < w - R; x += step) {
      const i = y * w + x;
      if (!mask[i] && outsideDist[i] > exclude) samples.push(i);
    }
  }

  let best = { dx: 0, dy: 0, err: Infinity };
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let err = 0;
      for (let s = 0; s < samples.length; s++) {
        const i = samples[s];
        // post shifted by (dx,dy): pixel i in the result samples post at i - dy*w - dx
        err += Math.abs(gray(pre, i) - gray(post, i - dy * w - dx));
      }
      if (err < best.err) best = { dx, dy, err };
    }
  }

  state.postAlign = { dx: best.dx, dy: best.dy };
  buildPostopWorkCanvas();
  renderPostopCanvas();
  const moved = best.dx !== saved.dx || best.dy !== saved.dy;
  toast(moved ? `Aligned post-op photo by (${best.dx}, ${best.dy}) px.` : `Already aligned (offset ${best.dx}, ${best.dy} px).`, 'success');
}

/* -------------------------------------------------------------
 * CLINICAL REPORT & EXPORT
 * ------------------------------------------------------------- */
function toothLabel() {
  return $("input-tooth")?.value.trim() || CASES[state.currentCase]?.tooth_name || "Unspecified tooth";
}

function updateClinicalReport() {
  const m = state.metrics;
  const mat = state.selectedMaterial;
  const dp = state.dispensePlan;
  if (!m) return;
  if (!state.evaluation && state.postWorkCanvas) state.evaluation = evaluateRestoration();
  const ev = state.evaluation;

  setText("report-date", new Date().toISOString().split("T")[0]);
  setText("report-case-id", state.caseId);
  setText("report-tooth", toothLabel());
  setText("report-patient", $("input-patient")?.value.trim() || "—");
  setText("report-clinician", $("input-clinician")?.value.trim() || "—");

  setText("rep-area", `${m.opening_area_mm2.toFixed(2)} mm²`);
  setText("rep-len", `${m.length_mm.toFixed(2)} mm`);
  setText("rep-wid", `${m.width_mm.toFixed(2)} mm`);
  setText("rep-depth", `${m.max_depth_mm.toFixed(2)} mm (probe input ${state.maxDepthHintMm.toFixed(1)} mm)`);
  setText("rep-vol", `${m.volume_mm3.toFixed(2)} mm³ (µL)`);
  setText("rep-cfactor", `${m.c_factor.toFixed(2)} (${cFactorLabel(m.c_factor)})`);
  setText("rep-scale", `${state.scale_px_per_mm.toFixed(1)} px/mm`);

  if (mat && dp) {
    setText("rep-mat-brand", mat.brand);
    setText("rep-mat-name", mat.name);
    setText("rep-mat-density", `${mat.density_g_per_cm3.toFixed(2)} g/cm³`);
    setText("rep-mat-shrink", `${mat.volumetric_shrinkage_percent.toFixed(2)}%`);
    setText("rep-comp-vol", `${dp.vCompensated.toFixed(2)} mm³ (k = ${dp.feedbackFactor.toFixed(3)})`);
    setText("rep-mass", `${dp.massMg.toFixed(1)} mg (${dp.massG.toFixed(4)} g)`);

    const tbody = $("report-layers-tbody");
    tbody.innerHTML = "";
    dp.layers.forEach(l => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>Layer ${l.num}</strong></td>
        <td>${l.name}</td>
        <td>${l.thickness.toFixed(1)} mm</td>
        <td>${l.vol.toFixed(1)} mm³</td>
        <td>${l.mass.toFixed(1)} mg</td>
        <td>${l.cure} s</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const seal = $("report-seal");
  const sign = (v) => (v >= 0 ? '+' : '−');
  if (ev) {
    setText("rep-post-status", ev.status.text);
    setText("rep-post-fill", `${ev.fill_percent.toFixed(1)}%`);
    setText("rep-post-dev", `${sign(ev.volumetric_deviation_mm3)}${Math.abs(ev.volumetric_deviation_mm3).toFixed(2)} mm³ (${sign(ev.deviation_percent)}${Math.abs(ev.deviation_percent).toFixed(1)}%)`);
    setText("rep-post-flash", `${ev.flash_area_mm2.toFixed(2)} mm²`);
    setText("rep-post-waste", `${ev.material_waste_percent.toFixed(1)}% (${ev.wasted_mass_mg.toFixed(1)} mg)`);
    setText("rep-post-k", `${ev.current_feedback_factor.toFixed(3)} → ${ev.recommended_next_feedback_factor.toFixed(3)}`);
    if (seal) { seal.textContent = ev.status.label.replace(/[✨⚠]/g, '').trim(); seal.className = `official-seal seal-${ev.status.key}`; }
  } else {
    ["rep-post-status", "rep-post-fill", "rep-post-dev", "rep-post-flash", "rep-post-waste", "rep-post-k"].forEach(id => setText(id, "Not assessed"));
    if (seal) { seal.textContent = "PLAN ONLY"; seal.className = "official-seal seal-pending"; }
  }

  // Figure snapshots
  const figPre = $("report-fig-preop");
  const figPost = $("report-fig-postop");
  const cav = $("cavity-canvas");
  if (figPre && cav?.width) figPre.src = cav.toDataURL("image/jpeg", 0.85);
  if (figPost) {
    if (ev) {
      const prevView = state.diffView;
      state.diffView = 'diff';
      renderPostopCanvas();
      figPost.src = $("postop-canvas").toDataURL("image/jpeg", 0.85);
      state.diffView = prevView;
      if (prevView !== 'diff') renderPostopCanvas();
      figPost.closest("figure")?.classList.remove("hidden");
    } else {
      figPost.closest("figure")?.classList.add("hidden");
    }
  }
}

function exportJSON() {
  if (!state.metrics || !state.dispensePlan) {
    toast("Nothing to export yet.", 'warn');
    return;
  }
  playClickSound(900);
  if (state.postWorkCanvas && !state.evaluation) state.evaluation = evaluateRestoration();
  const round = (v, d = 3) => (typeof v === 'number' ? parseFloat(v.toFixed(d)) : v);
  const roundObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
  const ev = state.evaluation;
  const mat = state.selectedMaterial;
  const dp = state.dispensePlan;

  const report = {
    generator: "Greenmix web client",
    generated_at: new Date().toISOString(),
    case_id: state.caseId,
    source_case: state.currentCase,
    tooth: toothLabel(),
    patient_ref: $("input-patient")?.value.trim() || null,
    clinician: $("input-clinician")?.value.trim() || null,
    calibration: {
      scale_px_per_mm: round(state.scale_px_per_mm),
      reference_length_mm: state.referenceLengthMm,
      probe_depth_mm: state.maxDepthHintMm,
      contour_sensitivity: state.sensitivity,
      working_resolution_px: [state.imageWidth, state.imageHeight]
    },
    cavity_metrics: roundObj(state.metrics),
    morphology: state.morphology ? roundObj(state.morphology) : null,
    material: { id: mat.id, brand: mat.brand, name: mat.name, density_g_per_cm3: mat.density_g_per_cm3, volumetric_shrinkage_percent: mat.volumetric_shrinkage_percent },
    dispensing_plan: {
      net_volume_mm3: round(dp.vNet),
      shrinkage_compensation_ratio: round(dp.compRatio, 4),
      c_factor_alpha: round(dp.alpha),
      feedback_factor_k: round(dp.feedbackFactor),
      target_volume_mm3: round(dp.vCompensated),
      mass_mg: round(dp.massMg, 2),
      layers: dp.layers.map(l => ({ num: l.num, name: l.name, thickness_mm: round(l.thickness, 2), volume_mm3: round(l.vol, 2), mass_mg: round(l.mass, 2), cure_s: l.cure }))
    },
    guided_placement: state.guided.cured.map(c => roundObj(c)),
    post_op_evaluation: ev ? (({ classes, status, alignment_px, ...rest }) => ({ status: status.key, alignment_px, ...roundObj(rest) }))(ev) : null,
    calibration_history: state.kHistory,
    disclaimer: "Photo-based estimates from a research prototype. Depth is modelled from the probe input, not measured. Not a medical device."
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `greenmix_${state.caseId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${a.download}`, 'success');
}

// Exposed for debugging from the browser console.
window.greenmix = { state, loadClinicalCase, recomputeCavityAnalysis, evaluateRestoration, autoAlignPostop };
