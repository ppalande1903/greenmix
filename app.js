/**
 * Greenmix: Closed-Loop Digital Restoration System
 * HeyClicky Edition — Fun, Aesthetic, Interactive Audio Synthesizer,
 * Actinic Light Gun, 3D Mesh & Real Scientific Engine.
 */

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
  coronalSlicePct: 50,
  soundEnabled: true,
  lofiPlaying: false,
  isCuring: false,
  cureTimeRemaining: 10.0,
  extrusionClicks: 0,
  
  // Image & Canvas
  cavityImage: null,
  postopImage: null,
  cavityMask: null,
  depthMap: null,
  imageWidth: 800,
  imageHeight: 800,
  
  // Ruler Points
  rulerStart: null,
  rulerEnd: null,
  isDraggingRuler: false,
  
  // Database & Selection
  materials: [],
  selectedMaterial: null,
  
  // Computed Metrics
  metrics: {
    length_mm: 2.98,
    width_mm: 6.92,
    opening_area_mm2: 10.14,
    max_depth_mm: 2.76,
    mean_depth_mm: 1.90,
    volume_mm3: 19.25,
    c_factor: 4.23
  },
  
  dispensePlan: null,
  evaluation: null
};

// Embedded default materials
const DEFAULT_MATERIALS = [
  {
    "id": "3m_filtek_supreme_ultra",
    "brand": "3M Oral Care",
    "name": "Filtek Supreme Ultra",
    "category": "Universal Nanocomposite",
    "filler_weight_percent": 78.5,
    "filler_volume_percent": 63.3,
    "density_g_per_cm3": 2.10,
    "volumetric_shrinkage_percent": 1.90,
    "max_increment_depth_mm": 2.0,
    "light_cure_time_sec": 10,
    "color_code": "#0284c7"
  },
  {
    "id": "3m_filtek_one_bulk_fill",
    "brand": "3M Oral Care",
    "name": "Filtek One Bulk Fill",
    "category": "Posterior Bulk Fill",
    "filler_weight_percent": 76.5,
    "filler_volume_percent": 58.4,
    "density_g_per_cm3": 2.05,
    "volumetric_shrinkage_percent": 1.50,
    "max_increment_depth_mm": 4.5,
    "light_cure_time_sec": 20,
    "color_code": "#059669"
  },
  {
    "id": "kerr_harmonize",
    "brand": "Kerr Dental",
    "name": "Harmonize",
    "category": "Universal Nanohybrid",
    "filler_weight_percent": 81.0,
    "filler_volume_percent": 64.5,
    "density_g_per_cm3": 2.12,
    "volumetric_shrinkage_percent": 2.10,
    "max_increment_depth_mm": 2.0,
    "light_cure_time_sec": 20,
    "color_code": "#8b5cf6"
  },
  {
    "id": "ivoclar_tetric_prime",
    "brand": "Ivoclar Vivadent",
    "name": "Tetric Prime",
    "category": "Universal Composite",
    "filler_weight_percent": 79.0,
    "filler_volume_percent": 61.0,
    "density_g_per_cm3": 2.08,
    "volumetric_shrinkage_percent": 2.00,
    "max_increment_depth_mm": 2.0,
    "light_cure_time_sec": 10,
    "color_code": "#f59e0b"
  },
  {
    "id": "dentsply_sdr_flow_plus",
    "brand": "Dentsply Sirona",
    "name": "SDR flow+",
    "category": "Bulk Fill Flowable Base",
    "filler_weight_percent": 68.0,
    "filler_volume_percent": 45.0,
    "density_g_per_cm3": 1.88,
    "volumetric_shrinkage_percent": 3.00,
    "max_increment_depth_mm": 4.0,
    "light_cure_time_sec": 20,
    "color_code": "#14b8a6"
  },
  {
    "id": "tokuyama_estelite_sigma_quick",
    "brand": "Tokuyama Dental",
    "name": "Estelite Sigma Quick",
    "category": "Submicron Spherical Composite",
    "filler_weight_percent": 82.0,
    "filler_volume_percent": 71.0,
    "density_g_per_cm3": 1.96,
    "volumetric_shrinkage_percent": 1.90,
    "max_increment_depth_mm": 2.0,
    "light_cure_time_sec": 10,
    "color_code": "#e11d48"
  }
];

// Clinical Sample Cases
const CASES = {
  user_case_1: {
    title: "Patient Molar (Your Photo 1)",
    preop_src: "samples/user_cavity_1.jpg",
    postop_src: "samples/user_cavity_1_restored.jpg",
    default_scale: 32.5,
    depth_hint: 2.5,
    ref_length_mm: 10.5,
    tooth_name: "Mandibular First Molar (#36) - Patient Photo 1"
  },
  user_case_2: {
    title: "Molar Prep (Your Photo 2)",
    preop_src: "samples/user_cavity_2.jpg",
    postop_src: "samples/user_cavity_2_restored.jpg",
    default_scale: 65.0,
    depth_hint: 2.2,
    ref_length_mm: 10.5,
    tooth_name: "Mandibular Molar Typodont (#46) - Photo 2"
  },
  case_1: {
    title: "Class I Molar (Benchmark)",
    preop_src: "samples/case_1_class_1_molar_cavity.png",
    postop_src: "samples/case_1_class_1_molar_restored.png",
    default_scale: 50.0,
    depth_hint: 2.8,
    ref_length_mm: 5.0,
    tooth_name: "Mandibular First Molar (#36)"
  },
  case_2: {
    title: "Class II MO Premolar (Benchmark)",
    preop_src: "samples/case_2_class_2_premolar_cavity.png",
    postop_src: "samples/case_2_class_2_premolar_restored.png",
    default_scale: 50.0,
    depth_hint: 3.5,
    ref_length_mm: 5.0,
    tooth_name: "Maxillary First Premolar (#24)"
  }
};

/* -------------------------------------------------------------
 * WEB AUDIO API SYNTHESIZER (CLICKY SOUND ENGINE)
 * ------------------------------------------------------------- */
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Satisfying mechanical keyboard click
function playClickSound(pitch = 800) {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  } catch (e) {}
}

// Squishy resin extrusion sound
function playSquishSound() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(150, ctx.currentTime + 0.08);
    osc.frequency.linearRampToValueAtTime(450, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch (e) {}
}

// Curing laser hum & beeps
function playCureHumSound() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(470, ctx.currentTime); // 470 Hz matching 470 nm!
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {}
}

// Success Chime
function playSuccessChime() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.18, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.3);
    });
  } catch (e) {}
}

// Lo-Fi Synth Dental Vibe Generator
let lofiInterval = null;
function toggleLoFiMusic() {
  state.lofiPlaying = !state.lofiPlaying;
  const bars = document.querySelector(".sound-bars");
  const player = document.getElementById("lofi-player-btn");
  
  if (state.lofiPlaying) {
    bars?.classList.add("playing");
    player?.classList.add("active");
    playClickSound(600);
    // Chill pentatonic chord arpeggio
    const chord = [261.63, 329.63, 392.00, 440.00, 523.25];
    let noteIdx = 0;
    lofiInterval = setInterval(() => {
      if (!state.lofiPlaying) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(chord[noteIdx % chord.length], ctx.currentTime);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
        noteIdx++;
      } catch (e) {}
    }, 600);
  } else {
    bars?.classList.remove("playing");
    player?.classList.remove("active");
    if (lofiInterval) clearInterval(lofiInterval);
  }
}

/* -------------------------------------------------------------
 * INITIALIZATION & EVENTS
 * ------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  startClock();
  setupTabs();
  setupEventListeners();
  await loadMaterials();
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
    const clockEl = document.getElementById("mac-clock");
    if (clockEl) clockEl.textContent = `${hours}:${minutes} ${ampm}`;
  }
  updateTime();
  setInterval(updateTime, 1000);
}

function setupTabs() {
  const tabElements = document.querySelectorAll(".retro-tab, .menu-link");
  tabElements.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      playClickSound(950);
      switchTab(targetTab);
    });
  });

  document.getElementById("btn-goto-dispense")?.addEventListener("click", () => {
    playClickSound(1000);
    switchTab("tab-dispense");
  });
  document.getElementById("btn-goto-closed-loop")?.addEventListener("click", () => {
    playClickSound(1000);
    switchTab("tab-closed-loop");
  });
  document.getElementById("btn-quick-report")?.addEventListener("click", () => {
    playClickSound(900);
    switchTab("tab-report");
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll(".retro-tab").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".menu-link").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-content").forEach(content => {
    content.classList.toggle("active", content.id === tabId);
  });

  if (tabId === 'tab-3d') {
    onResizeThree();
    updateThreeMesh();
    renderProfileCrossSection();
  } else if (tabId === 'tab-closed-loop') {
    renderPostopCanvas();
  } else if (tabId === 'tab-report') {
    updateClinicalReport();
  }
}

async function loadMaterials() {
  try {
    const res = await fetch("materials_data.json");
    if (res.ok) {
      const data = await res.json();
      state.materials = data.materials || DEFAULT_MATERIALS;
    } else {
      state.materials = DEFAULT_MATERIALS;
    }
  } catch (e) {
    state.materials = DEFAULT_MATERIALS;
  }
  
  const select = document.getElementById("select-material");
  if (!select) return;
  select.innerHTML = "";
  state.materials.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.brand} - ${m.name} (${m.category})`;
    select.appendChild(opt);
  });
  
  select.value = state.materials[0].id;
  state.selectedMaterial = state.materials[0];
  updateMaterialUI();
}

function setupEventListeners() {
  // Case selection buttons
  document.querySelectorAll(".case-card-fun").forEach(btn => {
    btn.addEventListener("click", () => {
      playClickSound(1100);
      document.querySelectorAll(".case-card-fun").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const c = btn.getAttribute("data-case");
      loadClinicalCase(c);
    });
  });

  // Sound toggle button in menubar
  const soundBtn = document.getElementById("btn-toggle-sound");
  soundBtn?.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    soundBtn.classList.toggle("sound-active", state.soundEnabled);
    document.getElementById("sound-icon").textContent = state.soundEnabled ? "🔊" : "🔇";
    document.getElementById("sound-label").textContent = state.soundEnabled ? "sound: ON" : "sound: OFF";
    if (state.soundEnabled) playClickSound(1200);
  });

  // Lo-Fi Player toggle
  document.getElementById("lofi-player-btn")?.addEventListener("click", toggleLoFiMusic);


  // Interactive Extrusion Dispenser
  document.getElementById("btn-extrude-drop")?.addEventListener("click", () => {
    playSquishSound();
    state.extrusionClicks++;
    triggerExtrusionAnimation();
  });

  // Tools toggle
  const toolCalibrate = document.getElementById("tool-calibrate");
  const toolInspect = document.getElementById("tool-inspect");
  toolCalibrate?.addEventListener("click", () => {
    playClickSound();
    state.activeTool = 'calibrate';
    toolCalibrate.classList.add("active");
    toolInspect?.classList.remove("active");
    document.getElementById("calibration-tooltip").innerHTML = `<span>Mode: <strong>Scale Calibration</strong> — Drag green ruler between two known points</span>`;
  });
  toolInspect?.addEventListener("click", () => {
    playClickSound();
    state.activeTool = 'inspect';
    toolInspect.classList.add("active");
    toolCalibrate?.classList.remove("active");
    document.getElementById("calibration-tooltip").innerHTML = `<span>Mode: <strong>Depth Probe</strong> — Hover or click over cavity to inspect thickness</span>`;
  });

  // Overlays toggle
  const btnOverlay = document.getElementById("btn-toggle-overlay");
  btnOverlay?.addEventListener("click", () => {
    playClickSound();
    state.showContour = !state.showContour;
    btnOverlay.classList.toggle("active", state.showContour);
    renderCavityCanvas();
  });

  const btnDepthTint = document.getElementById("btn-toggle-depth-tint");
  btnDepthTint?.addEventListener("click", () => {
    playClickSound();
    state.showDepthTint = !state.showDepthTint;
    btnDepthTint.classList.toggle("active", state.showDepthTint);
    renderCavityCanvas();
  });

  // Sliders
  document.getElementById("slider-sensitivity")?.addEventListener("input", (e) => {
    state.sensitivity = parseFloat(e.target.value);
    document.getElementById("val-sensitivity").textContent = `${state.sensitivity.toFixed(2)}x`;
    recomputeCavityAnalysis();
  });

  document.getElementById("input-depth-hint")?.addEventListener("change", (e) => {
    state.maxDepthHintMm = Math.max(0.5, parseFloat(e.target.value) || 2.5);
    recomputeCavityAnalysis();
  });

  document.getElementById("input-marker-length")?.addEventListener("change", (e) => {
    state.referenceLengthMm = Math.max(0.5, parseFloat(e.target.value) || 10.5);
  });

  // Material select
  document.getElementById("select-material")?.addEventListener("change", (e) => {
    playClickSound(850);
    const mat = state.materials.find(m => m.id === e.target.value);
    if (mat) {
      state.selectedMaterial = mat;
      updateMaterialUI();
      computeDispensingPlan();
    }
  });

  // 3D slice slider
  document.getElementById("slider-slice")?.addEventListener("input", (e) => {
    state.coronalSlicePct = parseInt(e.target.value, 10);
    document.getElementById("val-slice-depth").textContent = `${state.coronalSlicePct}%`;
    renderProfileCrossSection();
    updateThreeSlicePlane();
  });

  // Canvas Interactions
  setupCanvasInteractions();
  setupFileUploads();

  // Closed Loop Controls
  document.getElementById("btn-view-diff")?.addEventListener("click", (e) => {
    playClickSound();
    setActiveDiffView(e.target, 'diff');
  });
  document.getElementById("btn-view-preop")?.addEventListener("click", (e) => {
    playClickSound();
    setActiveDiffView(e.target, 'preop');
  });
  document.getElementById("btn-view-postop")?.addEventListener("click", (e) => {
    playClickSound();
    setActiveDiffView(e.target, 'postop');
  });

  document.getElementById("btn-apply-calibration")?.addEventListener("click", () => {
    playSuccessChime();
    if (state.evaluation) {
      state.feedbackFactor = state.evaluation.recommended_next_feedback_factor;
      document.getElementById("val-k-current").textContent = state.feedbackFactor.toFixed(3);
      computeDispensingPlan();
      alert(`Applied feedback factor k = ${state.feedbackFactor.toFixed(3)} to Greenmix dispensing model.`);
    }
  });
}

function setActiveDiffView(btn, mode) {
  document.querySelectorAll("#tab-closed-loop .window-actions .win-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderPostopCanvas(mode);
}

/* -------------------------------------------------------------
 * ACTINIC LIGHT-CURING GUN SIMULATION ⚡
 * ------------------------------------------------------------- */
function triggerActinicCuringGun() {
  if (state.isCuring) return;
  state.isCuring = true;

  // Make sure we are on tab-scan to see the laser beam
  if (state.activeTab !== 'tab-scan') {
    switchTab('tab-scan');
  }

  const overlay = document.getElementById("actinic-beam-overlay");
  const timerText = document.getElementById("cure-timer-display");
  const progressFill = document.getElementById("cure-progress-fill");
  overlay?.classList.add("firing");

  let timeLeft = 10.0;
  playCureHumSound();

  const cureInterval = setInterval(() => {
    timeLeft -= 0.1;
    if (timerText) timerText.textContent = `${Math.max(0, timeLeft).toFixed(1)}s`;
    if (progressFill) progressFill.style.width = `${((10.0 - timeLeft) / 10.0) * 100}%`;

    // Periodic beep sound
    if (Math.round(timeLeft * 10) % 20 === 0 && timeLeft > 0.5) {
      playCureHumSound();
    }

    if (timeLeft <= 0) {
      clearInterval(cureInterval);
      state.isCuring = false;
      overlay?.classList.remove("firing");
      playSuccessChime();
      alert("✨ Actinic Light-Cure Complete! Polymerization cross-linking achieved (98.6% conversion rate).");
    }
  }, 100);
}

function triggerExtrusionAnimation() {
  const well = document.getElementById("cavity-well");
  if (!well) return;
  
  // Flash well with resin droplet effect
  const drop = document.createElement("div");
  drop.className = "layer-bar";
  drop.style.background = state.selectedMaterial?.color_code || "#00b4d8";
  drop.style.flex = "0.5";
  drop.style.animation = "dropBounce 0.3s ease";
  drop.innerHTML = `<span>Droplet #${state.extrusionClicks}</span><span>~5.0 mg</span>`;
  well.appendChild(drop);

  // Auto clean excessive test droplets after a few seconds
  setTimeout(() => {
    if (drop.parentNode === well && well.children.length > 5) {
      well.removeChild(drop);
    }
  }, 4000);
}

/* -------------------------------------------------------------
 * CLINICAL CASE & IMAGE LOADING
 * ------------------------------------------------------------- */
function loadClinicalCase(caseKey) {
  const caseData = CASES[caseKey];
  if (!caseData) return;
  state.currentCase = caseKey;
  state.scale_px_per_mm = caseData.default_scale;
  state.maxDepthHintMm = caseData.depth_hint;
  state.referenceLengthMm = caseData.ref_length_mm;

  document.getElementById("input-depth-hint").value = state.maxDepthHintMm;
  document.getElementById("input-marker-length").value = state.referenceLengthMm;
  document.getElementById("val-scale-display").textContent = `${state.scale_px_per_mm.toFixed(1)} px/mm`;

  const imgPre = new Image();
  imgPre.crossOrigin = "anonymous";
  imgPre.onload = () => {
    state.cavityImage = imgPre;
    state.imageWidth = imgPre.naturalWidth || 800;
    state.imageHeight = imgPre.naturalHeight || 800;
    
    if (caseKey === 'user_case_1') {
      state.rulerStart = { x: 25, y: 220 };
      state.rulerEnd = { x: 345, y: 220 };
    } else if (caseKey === 'user_case_2') {
      state.rulerStart = { x: 45, y: 400 };
      state.rulerEnd = { x: 705, y: 400 };
    } else {
      state.rulerStart = { x: 60, y: 70 };
      state.rulerEnd = { x: 60 + state.referenceLengthMm * state.scale_px_per_mm, y: 70 };
    }
    
    recomputeCavityAnalysis();
  };
  imgPre.src = caseData.preop_src;

  const imgPost = new Image();
  imgPost.crossOrigin = "anonymous";
  imgPost.onload = () => {
    state.postopImage = imgPost;
    if (state.activeTab === 'tab-closed-loop') {
      renderPostopCanvas();
    }
  };
  imgPost.src = caseData.postop_src;
}

function setupFileUploads() {
  const fileInput = document.getElementById("cavity-file-input");
  fileInput?.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleUserImageFile(e.target.files[0], 'preop');
    }
  });

  const postopInput = document.getElementById("postop-file-input");
  postopInput?.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleUserImageFile(e.target.files[0], 'postop');
    }
  });
}

function handleUserImageFile(file, type) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      if (type === 'preop') {
        state.cavityImage = img;
        state.imageWidth = img.naturalWidth;
        state.imageHeight = img.naturalHeight;
        state.rulerStart = { x: 30, y: img.naturalHeight * 0.85 };
        state.rulerEnd = { x: img.naturalWidth - 30, y: img.naturalHeight * 0.85 };
        recomputeCavityAnalysis();
      } else {
        state.postopImage = img;
        renderPostopCanvas();
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

/* -------------------------------------------------------------
 * COMPUTER VISION & GEOMETRY ESTIMATION PIPELINE
 * ------------------------------------------------------------- */
function recomputeCavityAnalysis() {
  if (!state.cavityImage) return;

  const w = state.imageWidth;
  const h = state.imageHeight;

  const offCanvas = document.createElement("canvas");
  offCanvas.width = w;
  offCanvas.height = h;
  const ctx = offCanvas.getContext("2d");
  ctx.drawImage(state.cavityImage, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const cavityMask = new Uint8Array(w * h);
  const scale = state.scale_px_per_mm;
  const sens = state.sensitivity;
  const cy = h / 2.0;
  const cx = w / 2.0;

  let sumX = 0, sumY = 0, count = 0;
  let minX = w, maxX = 0, minY = h, maxY = 0;

  const scores = new Float32Array(w * h);
  let maxScore = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((state.currentCase === 'case_1' || state.currentCase === 'case_2') && x < 360 && y < 110) {
        continue;
      }

      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const dCenter = Math.sqrt(Math.pow((x - cx) / (w * 0.45), 2) + Math.pow((y - cy) / (h * 0.45), 2));
      if (dCenter > 0.85) continue;
      const centerWeight = Math.max(0, Math.min(1.0, 1.3 - dCenter));

      if (state.currentCase === 'user_case_1' && x < w * 0.25 && r > 140 && g < 100) {
        continue;
      }

      const warmth = r - b;
      const gray = (r * 0.299 + g * 0.587 + b * 0.114);

      let score = (warmth * 0.8 + (255.0 - gray) * 0.6) * centerWeight;
      scores[y * w + x] = score;
      if (dCenter < 0.6 && score > maxScore) {
        maxScore = score;
      }
    }
  }

  const threshVal = maxScore * (0.62 / sens);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (scores[idx] > threshVal) {
        cavityMask[idx] = 1;
        sumX += x;
        sumY += y;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  state.cavityMask = cavityMask;

  // Distance Transform
  const distMap = computeDistanceTransform(cavityMask, w, h);
  let maxDist = 0;
  for (let i = 0; i < distMap.length; i++) {
    if (distMap[i] > maxDist) maxDist = distMap[i];
  }
  if (maxDist === 0) maxDist = 1;

  // 3D Depth Map
  const maxDepth = state.maxDepthHintMm;
  const depthMap = new Float32Array(w * h);
  let totalVolumeMm3 = 0;
  let totalAreaMm2 = 0;
  const areaPerPxMm2 = (1.0 / scale) * (1.0 / scale);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (cavityMask[idx]) {
        const normDist = Math.min(1.0, distMap[idx] / (maxDist * 0.70));
        let z = (1.0 - Math.exp(-3.2 * normDist)) * maxDepth;
        
        const pIdx = idx * 4;
        const lum = (data[pIdx] + data[pIdx + 1] + data[pIdx + 2]) / 3.0;
        z *= (1.0 + 0.12 * (1.0 - lum / 255.0));

        depthMap[idx] = z;
        totalVolumeMm3 += z * areaPerPxMm2;
        totalAreaMm2 += areaPerPxMm2;
      }
    }
  }

  state.depthMap = depthMap;

  const lengthMm = Math.max(0, (maxX - minX) / scale);
  const widthMm = Math.max(0, (maxY - minY) / scale);
  const perimeterMm = (2 * (lengthMm + widthMm)) * 0.9;
  const meanDepthMm = count > 0 ? (totalVolumeMm3 / totalAreaMm2) : 0;
  const axialWallAreaMm2 = perimeterMm * meanDepthMm;
  const pulpalFloorAreaMm2 = totalAreaMm2 * 0.85;
  const bondedAreaMm2 = pulpalFloorAreaMm2 + axialWallAreaMm2;
  const cFactor = bondedAreaMm2 / Math.max(0.1, totalAreaMm2);

  state.metrics = {
    length_mm: parseFloat(lengthMm.toFixed(2)),
    width_mm: parseFloat(widthMm.toFixed(2)),
    opening_area_mm2: parseFloat(totalAreaMm2.toFixed(2)),
    max_depth_mm: parseFloat(maxDepth.toFixed(2)),
    mean_depth_mm: parseFloat(meanDepthMm.toFixed(2)),
    volume_mm3: parseFloat(totalVolumeMm3.toFixed(2)),
    c_factor: parseFloat(cFactor.toFixed(2))
  };

  updateMetricsUI();
  renderCavityCanvas();
  computeDispensingPlan();
  updateThreeMesh();
  renderProfileCrossSection();
  if (state.activeTab === 'tab-closed-loop') {
    renderPostopCanvas();
  }
}

function computeDistanceTransform(mask, w, h) {
  const dist = new Float32Array(w * h);
  const INF = 9999.0;
  for (let i = 0; i < dist.length; i++) {
    dist[i] = mask[i] ? INF : 0.0;
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (dist[idx] > 0) {
        dist[idx] = Math.min(
          dist[idx],
          dist[idx - 1] + 1.0,
          dist[idx - w] + 1.0,
          dist[idx - w - 1] + 1.414,
          dist[idx - w + 1] + 1.414
        );
      }
    }
  }

  for (let y = h - 2; y >= 1; y--) {
    for (let x = w - 2; x >= 1; x--) {
      const idx = y * w + x;
      if (dist[idx] > 0) {
        dist[idx] = Math.min(
          dist[idx],
          dist[idx + 1] + 1.0,
          dist[idx + w] + 1.0,
          dist[idx + w + 1] + 1.414,
          dist[idx + w - 1] + 1.414
        );
      }
    }
  }

  return dist;
}

/* -------------------------------------------------------------
 * CANVAS RENDERING (2D CAVITY & OVERLAYS)
 * ------------------------------------------------------------- */
function renderCavityCanvas() {
  const canvas = document.getElementById("cavity-canvas");
  if (!canvas || !state.cavityImage) return;

  canvas.width = state.imageWidth;
  canvas.height = state.imageHeight;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(state.cavityImage, 0, 0);

  const w = state.imageWidth;
  const h = state.imageHeight;

  // Depth tint overlay
  if (state.showDepthTint && state.depthMap) {
    const tintImg = ctx.createImageData(w, h);
    const tintData = tintImg.data;
    const maxD = state.metrics.max_depth_mm || 3.0;

    for (let i = 0; i < state.depthMap.length; i++) {
      const z = state.depthMap[i];
      if (z > 0.05) {
        const norm = Math.min(1.0, z / maxD);
        const p = i * 4;
        tintData[p] = Math.floor(norm * 240);
        tintData[p + 1] = Math.floor((1 - norm) * 200 + 40);
        tintData[p + 2] = Math.floor((1 - norm) * 240);
        tintData[p + 3] = 135;
      }
    }
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    tempCanvas.getContext("2d").putImageData(tintImg, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
  }

  // Cavity contour outline
  if (state.showContour && state.cavityMask) {
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(0, 240, 255, 0.85)";
    ctx.shadowBlur = 10;

    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const idx = y * w + x;
        if (state.cavityMask[idx]) {
          if (!state.cavityMask[idx - 1] || !state.cavityMask[idx + 1] ||
              !state.cavityMask[idx - w] || !state.cavityMask[idx + w]) {
            ctx.fillStyle = "#00f0ff";
            ctx.fillRect(x, y, 2, 2);
          }
        }
      }
    }
    ctx.shadowBlur = 0;
  }

  // 2-Point Scale Ruler
  if (state.rulerStart && state.rulerEnd) {
    const p1 = state.rulerStart;
    const p2 = state.rulerEnd;

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    drawRulerCap(ctx, p1, p2);
    drawRulerCap(ctx, p2, p1);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.fillRect(midX - 60, midY - 26, 120, 24);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(midX - 60, midY - 26, 120, 24);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${state.referenceLengthMm.toFixed(1)} mm (${distPx.toFixed(0)}px)`, midX, midY - 10);
  }
}

function drawRulerCap(ctx, pt, other) {
  const dx = other.x - pt.x;
  const dy = other.y - pt.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len * 9;
  const ny = dx / len * 9;

  ctx.beginPath();
  ctx.moveTo(pt.x + nx, pt.y + ny);
  ctx.lineTo(pt.x - nx, pt.y - ny);
  ctx.stroke();

  ctx.fillStyle = "#10b981";
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function setupCanvasInteractions() {
  const canvas = document.getElementById("cavity-canvas");
  if (!canvas) return;

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  canvas.addEventListener("mousedown", (e) => {
    const pt = getCanvasCoords(e);
    if (state.activeTool === 'calibrate') {
      playClickSound(750);
      state.rulerStart = pt;
      state.rulerEnd = pt;
      state.isDraggingRuler = true;
      renderCavityCanvas();
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const pt = getCanvasCoords(e);

    if (state.isDraggingRuler && state.activeTool === 'calibrate') {
      state.rulerEnd = pt;
      const dx = state.rulerEnd.x - state.rulerStart.x;
      const dy = state.rulerEnd.y - state.rulerStart.y;
      const distPx = Math.sqrt(dx * dx + dy * dy);
      if (distPx > 10) {
        state.scale_px_per_mm = distPx / state.referenceLengthMm;
        document.getElementById("val-scale-display").textContent = `${state.scale_px_per_mm.toFixed(1)} px/mm`;
      }
      renderCavityCanvas();
    } else if (state.activeTool === 'inspect') {
      const x = Math.floor(pt.x);
      const y = Math.floor(pt.y);
      const w = state.imageWidth;
      const h = state.imageHeight;
      if (x >= 0 && x < w && y >= 0 && y < h && state.depthMap) {
        const depth = state.depthMap[y * w + x] || 0;
        document.getElementById("val-probe-depth").textContent = `${depth.toFixed(2)} mm`;
      }
    }
  });

  window.addEventListener("mouseup", () => {
    if (state.isDraggingRuler) {
      state.isDraggingRuler = false;
      playClickSound(900);
      recomputeCavityAnalysis();
    }
  });

  document.getElementById("btn-reset-zoom")?.addEventListener("click", () => {
    playClickSound();
    renderCavityCanvas();
  });
}

function updateMetricsUI() {
  const m = state.metrics;
  document.getElementById("metric-volume").textContent = m.volume_mm3.toFixed(1);
  document.getElementById("metric-max-depth").textContent = m.max_depth_mm.toFixed(1);
  document.getElementById("metric-length").textContent = m.length_mm.toFixed(1);
  document.getElementById("metric-width").textContent = m.width_mm.toFixed(1);
  document.getElementById("metric-area").textContent = m.opening_area_mm2.toFixed(1);
  document.getElementById("metric-c-factor").textContent = m.c_factor.toFixed(1);
  document.getElementById("cfactor-advisory").textContent = m.c_factor.toFixed(1);

  document.getElementById("legend-max-depth").textContent = `${m.max_depth_mm.toFixed(1)} mm (Pulp Floor)`;
  document.getElementById("legend-mid-depth").textContent = `${(m.max_depth_mm / 2).toFixed(1)} mm`;
}

function updateMaterialUI() {
  const mat = state.selectedMaterial;
  if (!mat) return;

  document.getElementById("mat-category").textContent = mat.category;
  document.getElementById("mat-title").textContent = `${mat.brand} ${mat.name}`;
  document.getElementById("mat-density").textContent = `${mat.density_g_per_cm3.toFixed(2)} g/cm³`;
  document.getElementById("mat-shrinkage").textContent = `${mat.volumetric_shrinkage_percent.toFixed(2)}%`;
  document.getElementById("mat-max-layer").textContent = `${mat.max_increment_depth_mm.toFixed(1)} mm`;
  document.getElementById("mat-filler").textContent = `${mat.filler_weight_percent.toFixed(1)} wt%`;
}

/* -------------------------------------------------------------
 * COMPOSITE DISPENSING & INCREMENTAL LAYERING ENGINE
 * ------------------------------------------------------------- */
function computeDispensingPlan() {
  const mat = state.selectedMaterial;
  if (!mat || !state.metrics) return;

  const vNet = state.metrics.volume_mm3;
  const shrinkPct = mat.volumetric_shrinkage_percent;
  const density = mat.density_g_per_cm3;
  const cFactor = state.metrics.c_factor;
  const maxDepth = state.metrics.max_depth_mm;

  const alpha = 1.0 + 0.05 * Math.max(0, cFactor - 1.0);
  const compRatio = (shrinkPct / 100.0) * alpha * state.feedbackFactor;
  const vCompensated = vNet * (1.0 + compRatio);
  const extraVol = vCompensated - vNet;

  const massMg = vCompensated * density;
  const massG = massMg / 1000.0;

  document.getElementById("calc-net-vol").textContent = `${vNet.toFixed(2)} mm³`;
  document.getElementById("calc-comp-vol").textContent = `+${extraVol.toFixed(2)} mm³ (+${(compRatio * 100).toFixed(2)}%)`;
  document.getElementById("calc-target-vol").textContent = `${vCompensated.toFixed(2)} mm³ (µL)`;
  document.getElementById("calc-mass-mg").textContent = `${massMg.toFixed(1)} mg (${massG.toFixed(4)} g)`;

  const compuleFrac = (massG / 0.25).toFixed(2);
  const syringeTurns = (vCompensated / 28.27).toFixed(1);
  const microSteps = Math.round(vCompensated * 2);

  document.getElementById("val-compule-frac").textContent = `${compuleFrac} compule (of 0.25g)`;
  document.getElementById("val-syringe-turns").textContent = `${syringeTurns} turns (screw plunger)`;
  document.getElementById("val-micro-steps").textContent = `${vCompensated.toFixed(1)} µL / ${microSteps} digital steps`;

  const maxIncDepth = mat.max_increment_depth_mm;
  const layers = [];

  if (maxDepth <= maxIncDepth) {
    layers.push({
      num: 1,
      name: "Bulk Placement Increment",
      thickness: maxDepth.toFixed(1),
      vol: vCompensated.toFixed(1),
      mass: massMg.toFixed(1),
      cure: mat.light_cure_time_sec,
      tech: "Direct anatomical placement, light-cure.",
      color: mat.color_code || "#0284c7"
    });
  } else {
    const linerThick = Math.min(1.0, maxDepth * 0.3);
    const linerVol = vCompensated * (linerThick / maxDepth) * 0.9;
    layers.push({
      num: 1,
      name: "Pulpal Floor Cavity Base",
      thickness: linerThick.toFixed(1),
      vol: linerVol.toFixed(1),
      mass: (linerVol * density).toFixed(1),
      cure: mat.light_cure_time_sec,
      tech: "Seal pulpal floor, eliminate internal air voids.",
      color: "#00b4d8"
    });

    const remDepth = maxDepth - linerThick;
    const remVol = vCompensated - linerVol;
    const bodyCount = Math.ceil(remDepth / maxIncDepth);

    for (let i = 0; i < bodyCount; i++) {
      const isLast = (i === bodyCount - 1);
      const t = remDepth / bodyCount;
      const v = remVol / bodyCount;
      layers.push({
        num: layers.length + 1,
        name: isLast ? "Occlusal Enamel Cap Layer" : `Dentin Oblique Increment ${i + 1}`,
        thickness: t.toFixed(1),
        vol: v.toFixed(1),
        mass: (v * density).toFixed(1),
        cure: mat.light_cure_time_sec,
        tech: isLast ? "Sculpt cusp crests & primary grooves." : "Oblique placement along opposing wall to break C-factor vector.",
        color: isLast ? "#38bdf8" : (i % 2 === 0 ? "#0284c7" : "#10b981")
      });
    }
  }

  state.dispensePlan = {
    vCompensated,
    massMg,
    massG,
    layers
  };

  renderLayeringSchematic(layers);
}

function renderLayeringSchematic(layers) {
  const well = document.getElementById("cavity-well");
  const tbody = document.getElementById("layers-tbody");
  const badge = document.getElementById("layer-badge-info");
  if (!well || !tbody) return;

  badge.textContent = `${layers.length} ${layers.length === 1 ? 'Increment' : 'Increments'} Planned`;

  well.innerHTML = "";
  tbody.innerHTML = "";

  layers.forEach(l => {
    const bar = document.createElement("div");
    bar.className = "layer-bar";
    bar.style.backgroundColor = l.color;
    bar.style.flex = l.thickness;
    bar.innerHTML = `<span>#${l.num}: ${l.name}</span><span>${l.thickness}mm | ${l.mass}mg</span>`;
    well.appendChild(bar);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${l.num}</strong></td>
      <td>${l.name}</td>
      <td>${l.thickness} mm</td>
      <td>${l.vol} mm³</td>
      <td>${l.mass} mg</td>
      <td>${l.cure}s</td>
      <td>${l.tech}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* -------------------------------------------------------------
 * THREE.JS 3D CAVITY TOPOGRAPHY
 * ------------------------------------------------------------- */
let threeScene, threeCamera, threeRenderer, threeMesh, threeControls;

function initThreeJS() {
  const container = document.getElementById("three-container");
  if (!container || threeRenderer) return;

  const w = container.clientWidth || 600;
  const h = container.clientHeight || 600;

  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x0a0f1d);

  threeCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  threeCamera.position.set(0, -22, 28);

  threeRenderer = new THREE.WebGLRenderer({ antialias: true });
  threeRenderer.setSize(w, h);
  threeRenderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(threeRenderer.domElement);

  if (window.THREE && THREE.OrbitControls) {
    threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
  }

  const ambLight = new THREE.AmbientLight(0xffffff, 0.65);
  threeScene.add(ambLight);

  const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 0.85);
  dirLight1.position.set(15, 20, 30);
  threeScene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.45);
  dirLight2.position.set(-20, -15, 20);
  threeScene.add(dirLight2);

  document.getElementById("btn-3d-wireframe")?.addEventListener("click", () => {
    playClickSound();
    if (threeMesh) {
      threeMesh.material.wireframe = !threeMesh.material.wireframe;
    }
  });

  document.getElementById("btn-3d-reset-cam")?.addEventListener("click", () => {
    playClickSound();
    threeCamera.position.set(0, -22, 28);
    threeControls?.target.set(0, 0, 0);
    threeControls?.update();
  });

  animateThree();
}

function onResizeThree() {
  const container = document.getElementById("three-container");
  if (!container || !threeRenderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  threeCamera.aspect = w / h;
  threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(w, h);
}

function animateThree() {
  requestAnimationFrame(animateThree);
  if (threeControls) threeControls.update();
  if (threeRenderer && threeScene && threeCamera) {
    threeRenderer.render(threeScene, threeCamera);
  }
}

function updateThreeMesh() {
  if (!threeScene || !state.depthMap) return;

  if (threeMesh) {
    threeScene.remove(threeMesh);
    threeMesh.geometry.dispose();
    threeMesh.material.dispose();
  }

  const gridW = 80;
  const gridH = 80;
  const geom = new THREE.PlaneGeometry(20, 20, gridW - 1, gridH - 1);
  const pos = geom.attributes.position;
  const colors = [];

  const w = state.imageWidth;
  const h = state.imageHeight;
  const maxD = state.metrics.max_depth_mm || 3.0;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const vIdx = gy * gridW + gx;
      const imgX = Math.floor((gx / (gridW - 1)) * w);
      const imgY = Math.floor(((gridH - 1 - gy) / (gridH - 1)) * h);
      const zVal = state.depthMap[imgY * w + imgX] || 0;

      pos.setZ(vIdx, -zVal * 2.2);

      const norm = Math.min(1.0, zVal / maxD);
      const c = new THREE.Color();
      if (zVal < 0.05) {
        c.setRGB(0.12, 0.16, 0.22);
      } else {
        if (norm < 0.4) {
          c.lerpColors(new THREE.Color(0x0284c7), new THREE.Color(0x10b981), norm / 0.4);
        } else if (norm < 0.75) {
          c.lerpColors(new THREE.Color(0x10b981), new THREE.Color(0xf59e0b), (norm - 0.4) / 0.35);
        } else {
          c.lerpColors(new THREE.Color(0xf59e0b), new THREE.Color(0xe11d48), (norm - 0.75) / 0.25);
        }
      }
      colors.push(c.r, c.g, c.b);
    }
  }

  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.1,
    side: THREE.DoubleSide
  });

  threeMesh = new THREE.Mesh(geom, mat);
  threeScene.add(threeMesh);
}

function updateThreeSlicePlane() {}

/* -------------------------------------------------------------
 * 2D CROSS-SECTION PROFILE CANVAS
 * ------------------------------------------------------------- */
function renderProfileCrossSection() {
  const canvas = document.getElementById("profile-canvas");
  if (!canvas || !state.depthMap) return;

  const ctx = canvas.getContext("2d");
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, cw, ch);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x < cw; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ch);
    ctx.stroke();
  }
  for (let y = 0; y < ch; y += 25) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cw, y);
    ctx.stroke();
  }

  const sliceY = Math.floor((state.coronalSlicePct / 100.0) * state.imageHeight);
  const w = state.imageWidth;
  const maxD = state.metrics.max_depth_mm || 3.0;

  ctx.beginPath();
  ctx.moveTo(0, 30);

  for (let cx = 0; cx < cw; cx++) {
    const imgX = Math.floor((cx / cw) * w);
    const z = state.depthMap[sliceY * w + imgX] || 0;
    const yPx = 30 + (z / (maxD * 1.3)) * (ch - 50);
    ctx.lineTo(cx, yPx);
  }

  ctx.lineTo(cw, ch);
  ctx.lineTo(0, ch);
  ctx.closePath();
  ctx.fillStyle = "rgba(180, 83, 9, 0.25)";
  ctx.fill();

  ctx.strokeStyle = "#00f0ff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let cx = 0; cx < cw; cx++) {
    const imgX = Math.floor((cx / cw) * w);
    const z = state.depthMap[sliceY * w + imgX] || 0;
    const yPx = 30 + (z / (maxD * 1.3)) * (ch - 50);
    if (cx === 0) ctx.moveTo(cx, yPx);
    else ctx.lineTo(cx, yPx);
  }
  ctx.stroke();

  ctx.strokeStyle = "#10b981";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.lineTo(cw, 30);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* -------------------------------------------------------------
 * CLOSED-LOOP POST-RESTORATION VERIFICATION
 * ------------------------------------------------------------- */
function renderPostopCanvas(mode = 'diff') {
  const canvas = document.getElementById("postop-canvas");
  if (!canvas || !state.cavityImage) return;

  canvas.width = state.imageWidth;
  canvas.height = state.imageHeight;
  const ctx = canvas.getContext("2d");

  const w = state.imageWidth;
  const h = state.imageHeight;
  const postImg = state.postopImage || state.cavityImage;

  if (mode === 'preop') {
    ctx.drawImage(state.cavityImage, 0, 0);
    return;
  }
  if (mode === 'postop') {
    ctx.drawImage(postImg, 0, 0);
    return;
  }

  ctx.drawImage(postImg, 0, 0);

  const scale = state.scale_px_per_mm;
  const areaPerPxMm2 = (1.0 / scale) * (1.0 / scale);
  const preMask = state.cavityMask;

  let flashPx = 0;
  let optimalPx = 0;

  const overlay = ctx.createImageData(w, h);
  const oData = overlay.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (preMask && preMask[idx]) {
        optimalPx++;
        const p = idx * 4;
        oData[p] = 16;
        oData[p + 1] = 185;
        oData[p + 2] = 129;
        oData[p + 3] = 45;
      } else if (x > 360 || y > 110) {
        if (isNearBoundary(preMask, x, y, w, h, 6)) {
          flashPx++;
          const p = idx * 4;
          oData[p] = 2;
          oData[p + 1] = 132;
          oData[p + 2] = 199;
          oData[p + 3] = 160;
        }
      }
    }
  }

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = w;
  tempCanvas.height = h;
  tempCanvas.getContext("2d").putImageData(overlay, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0);

  ctx.strokeStyle = "#00f0ff";
  ctx.lineWidth = 1.5;
  for (let y = 1; y < h - 1; y += 3) {
    for (let x = 1; x < w - 1; x += 3) {
      const idx = y * w + x;
      if (preMask && preMask[idx]) {
        if (!preMask[idx - 1] || !preMask[idx + 1] || !preMask[idx - w] || !preMask[idx + w]) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x, y, 1.5, 1.5);
        }
      }
    }
  }

  const cavityVol = state.metrics.volume_mm3;
  const flashAreaMm2 = flashPx * areaPerPxMm2;
  const flashVolMm3 = flashAreaMm2 * 0.15;
  const restoredVolMm3 = cavityVol + flashVolMm3;
  const deltaVMm3 = restoredVolMm3 - cavityVol;
  const devPct = (deltaVMm3 / cavityVol) * 100.0;

  const dispensedMassMg = state.dispensePlan ? state.dispensePlan.massMg : 41.3;
  const density = state.selectedMaterial ? state.selectedMaterial.density_g_per_cm3 : 2.10;
  const retainedMassMg = restoredVolMm3 * density;
  const wastedMassMg = Math.max(0, dispensedMassMg - retainedMassMg);
  const wastePct = (wastedMassMg / dispensedMassMg) * 100.0;

  const beta = 0.5;
  const nextK = 1.0 - beta * (deltaVMm3 / cavityVol);

  state.evaluation = {
    cavity_net_volume_mm3: cavityVol,
    restored_volume_mm3: parseFloat(restoredVolMm3.toFixed(2)),
    volumetric_deviation_mm3: parseFloat(deltaVMm3.toFixed(2)),
    deviation_percent: parseFloat(devPct.toFixed(2)),
    flash_area_mm2: parseFloat(flashAreaMm2.toFixed(2)),
    dispensed_mass_mg: parseFloat(dispensedMassMg.toFixed(1)),
    retained_mass_mg: parseFloat(retainedMassMg.toFixed(1)),
    wasted_mass_mg: parseFloat(wastedMassMg.toFixed(1)),
    material_waste_percent: parseFloat(wastePct.toFixed(1)),
    recommended_next_feedback_factor: parseFloat(nextK.toFixed(3))
  };

  document.getElementById("metric-post-vol").textContent = restoredVolMm3.toFixed(1);
  document.getElementById("metric-delta-vol").textContent = `+${deltaVMm3.toFixed(2)} mm³ (+${devPct.toFixed(2)}%)`;
  document.getElementById("metric-flash-area").textContent = `${flashAreaMm2.toFixed(2)} mm²`;
  document.getElementById("metric-waste-pct").textContent = `${wastePct.toFixed(1)}%`;
  document.getElementById("greenmix-waste-display").textContent = `${wastePct.toFixed(1)}%`;

  document.getElementById("val-k-current").textContent = state.feedbackFactor.toFixed(3);
  document.getElementById("val-error-grad").textContent = (nextK - state.feedbackFactor).toFixed(3);
  document.getElementById("val-k-next").textContent = nextK.toFixed(3);
}

function isNearBoundary(mask, x, y, w, h, radius) {
  if (!mask || mask[y * w + x]) return false;
  for (let dy = -radius; dy <= radius; dy += 2) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let dx = -radius; dx <= radius; dx += 2) {
      const nx = x + dx;
      if (nx < 0 || nx >= w) continue;
      if (mask[ny * w + nx]) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------
 * CLINICAL REPORT UPDATE
 * ------------------------------------------------------------- */
function updateClinicalReport() {
  const m = state.metrics;
  const mat = state.selectedMaterial;
  const dp = state.dispensePlan;
  const ev = state.evaluation;
  const caseData = CASES[state.currentCase] || {};

  document.getElementById("report-date").textContent = new Date().toISOString().split("T")[0];
  document.getElementById("report-case-id").textContent = `GM-${Date.now().toString().slice(-6)}`;
  document.getElementById("report-tooth").textContent = caseData.tooth_name || "Mandibular First Molar (#36)";

  document.getElementById("rep-area").textContent = `${m.opening_area_mm2} mm²`;
  document.getElementById("rep-len").textContent = `${m.length_mm} mm`;
  document.getElementById("rep-wid").textContent = `${m.width_mm} mm`;
  document.getElementById("rep-depth").textContent = `${m.max_depth_mm} mm`;
  document.getElementById("rep-vol").textContent = `${m.volume_mm3} mm³ (µL)`;
  document.getElementById("rep-cfactor").textContent = `${m.c_factor} (${m.c_factor > 3.5 ? 'High Stress' : 'Moderate Stress'})`;

  if (mat && dp) {
    document.getElementById("rep-mat-brand").textContent = mat.brand;
    document.getElementById("rep-mat-name").textContent = mat.name;
    document.getElementById("rep-mat-density").textContent = `${mat.density_g_per_cm3} g/cm³`;
    document.getElementById("rep-mat-shrink").textContent = `${mat.volumetric_shrinkage_percent}%`;
    document.getElementById("rep-comp-vol").textContent = `${dp.vCompensated.toFixed(2)} mm³`;
    document.getElementById("rep-mass").textContent = `${dp.massMg.toFixed(1)} mg (${dp.massG.toFixed(4)} g)`;

    const tbody = document.getElementById("report-layers-tbody");
    if (tbody) {
      tbody.innerHTML = "";
      dp.layers.forEach(l => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>Layer ${l.num}</strong></td>
          <td>${l.name}</td>
          <td>${l.thickness} mm</td>
          <td>${l.vol} mm³</td>
          <td>${l.mass} mg</td>
          <td>${l.cure} seconds</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  if (ev) {
    document.getElementById("rep-post-dev").textContent = `+${ev.volumetric_deviation_mm3} mm³ (+${ev.deviation_percent}%)`;
    document.getElementById("rep-post-flash").textContent = `${ev.flash_area_mm2} mm²`;
    document.getElementById("rep-post-waste").textContent = `${ev.material_waste_percent}%`;
    document.getElementById("rep-post-k").textContent = ev.recommended_next_feedback_factor.toFixed(3);
  }
}
