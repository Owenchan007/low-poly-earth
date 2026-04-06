// ============================================================
//  Low Poly Earth — 手势交互新媒体艺术
//  Three.js + MediaPipe Hands
// ============================================================

import * as THREE from 'three';

// ---- State ----
const state = {
  globe: null,
  camera: null,
  renderer: null,
  scene: null,
  stars: null,
  // Gesture
  handDetected: false,
  currentGesture: 'none', // 'none' | 'palm_zoom' | 'palm_rotate'
  // Globe transform
  targetRotX: 0,
  targetRotY: 0,
  rotX: 0.3,
  rotY: 0,
  autoRotateSpeed: 0.002,
  targetZoom: 2.8,
  zoom: 2.8,
  // Mouse fallback
  isDragging: false,
  lastMouse: { x: 0, y: 0 },
  // Palm tracking
  prevPalmPos: null,
  prevPalmSize: null, // for zoom by palm distance
  // Fist detection
  gestureSmoothing: [],
  // MediaPipe
  hands: null,
  camera2: null, // mediapipe camera
};

// ---- DOM refs ----
const canvas = document.getElementById('globe-canvas');
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const webcamEl = document.getElementById('webcam');
const handOverlay = document.getElementById('hand-overlay');

// Status elements
const detectionStatus = document.getElementById('detection-status');
const gestureType = document.getElementById('gesture-type');
const zoomLevel = document.getElementById('zoom-level');
const rotationAngle = document.getElementById('rotation-angle');
const camStatus = document.getElementById('cam-status');
const instructionTip = document.getElementById('instruction-tip');

// ============================================================
//  1. THREE.JS SCENE
// ============================================================

function initScene() {
  // Renderer
  state.renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setClearColor(0x050510, 1);

  // Scene
  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.FogExp2(0x050510, 0.015);

  // Camera
  state.camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  state.camera.position.z = state.zoom;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x4060a0, 0.5);
  state.scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 3, 5);
  state.scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0x60a5fa, 0.4);
  dirLight2.position.set(-3, -2, -3);
  state.scene.add(dirLight2);

  const pointLight = new THREE.PointLight(0xa78bfa, 0.6, 10);
  pointLight.position.set(-2, 3, 2);
  state.scene.add(pointLight);

  // Create globe
  createGlobe();

  // Create stars
  createStars();

  // Create atmosphere glow
  createAtmosphere();

  // Start render loop
  animate();
}

// ---- Low Poly Earth ----
function createGlobe() {
  const detail = 4; // icosahedron detail level
  const geometry = new THREE.IcosahedronGeometry(1, detail);

  // Displace vertices for terrain effect
  const positions = geometry.attributes.position;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    const noise = simplex3D(vertex.x * 2, vertex.y * 2, vertex.z * 2);
    const displacement = 1.0 + noise * 0.08;
    vertex.normalize().multiplyScalar(displacement);
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  // Per-face coloring (pastel/neon palette)
  const faceCount = positions.count / 3;
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();

  // Color palettes for land and ocean
  const oceanColors = [
    '#1e3a5f', '#1a4b7a', '#2563eb', '#3b82f6', '#0ea5e9',
    '#1e40af', '#1d4ed8', '#0c4a6e', '#155e75', '#164e63',
    '#0369a1', '#0284c7', '#38bdf8',
  ];
  const landColors = [
    '#34d399', '#6ee7b7', '#a7f3d0', '#86efac', '#4ade80',
    '#a3e635', '#bef264', '#d9f99d', '#10b981', '#059669',
    '#22c55e', '#16a34a', '#65a30d',
  ];
  const snowColors = ['#e2e8f0', '#f1f5f9', '#f8fafc', '#dbeafe', '#e0e7ff', '#c7d2fe'];
  const desertColors = ['#fcd34d', '#fde68a', '#fef3c7', '#d97706', '#b45309', '#f59e0b', '#fbbf24'];

  for (let i = 0; i < positions.count; i += 3) {
    // Get face centroid
    const cx = (positions.getX(i) + positions.getX(i+1) + positions.getX(i+2)) / 3;
    const cy = (positions.getY(i) + positions.getY(i+1) + positions.getY(i+2)) / 3;
    const cz = (positions.getZ(i) + positions.getZ(i+1) + positions.getZ(i+2)) / 3;

    const dist = Math.sqrt(cx*cx + cy*cy + cz*cz);
    const lat = Math.asin(cy / dist);
    const lon = Math.atan2(cz, cx);
    const noise = simplex3D(cx * 2.5, cy * 2.5, cz * 2.5);
    const noise2 = simplex3D(cx * 5, cy * 5, cz * 5) * 0.3;
    const combined = noise + noise2;

    let palette;
    if (Math.abs(lat) > 1.1) {
      // Polar caps
      palette = snowColors;
    } else if (Math.abs(lat) > 0.95 && combined > -0.1) {
      // Tundra / snow edge
      palette = Math.random() > 0.5 ? snowColors : landColors;
    } else if (combined > 0.0) {
      // Land (more generous threshold)
      if (Math.abs(lat) < 0.4 && combined < 0.15) {
        // Tropical desert belt
        palette = desertColors;
      } else {
        palette = landColors;
      }
    } else if (combined > -0.15 && Math.abs(lat) < 0.6) {
      // Coastal / shallow water — mixed
      palette = Math.random() > 0.4 ? landColors : oceanColors;
    } else {
      // Ocean
      palette = oceanColors;
    }

    const chosen = palette[Math.floor(Math.random() * palette.length)];
    color.set(chosen);

    // Add slight variation
    color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);

    for (let j = 0; j < 3; j++) {
      colors[(i + j) * 3] = color.r;
      colors[(i + j) * 3 + 1] = color.g;
      colors[(i + j) * 3 + 2] = color.b;
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Material — flat shading for low-poly look
  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    flatShading: true,
    shininess: 15,
    specular: new THREE.Color(0x3366aa),
  });

  state.globe = new THREE.Mesh(geometry, material);
  state.globe.rotation.x = 0.3;
  state.scene.add(state.globe);

  // Wireframe overlay (subtle)
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.03,
  });
  const wireMesh = new THREE.Mesh(geometry.clone(), wireMat);
  state.globe.add(wireMesh);
}

// ---- Stars (Enhanced) ----
function createStars() {
  // Layer 1: Dense small stars — close and visible
  createStarLayer(15000, 30, 0.08, 1.0);
  // Layer 2: Medium bright stars
  createStarLayer(5000, 20, 0.15, 1.0);
  // Layer 3: Sparse large bright stars
  state.stars = createStarLayer(1000, 15, 0.3, 1.0);

  // Create a few colored nebula-like star clusters
  createNebulaCluster(new THREE.Vector3(15, 10, -30), 0x60a5fa, 300);
  createNebulaCluster(new THREE.Vector3(-20, -8, -25), 0xa78bfa, 250);
  createNebulaCluster(new THREE.Vector3(10, -15, -35), 0xf472b6, 200);

  // Shooting stars / meteors
  createShootingStars();
}

function createStarLayer(count, spread, size, opacity) {
  const starGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const twinklePhase = new Float32Array(count);
  const twinkleSpeed = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
    opacities[i] = opacity * (0.5 + Math.random() * 0.5);
    twinklePhase[i] = Math.random() * Math.PI * 2;
    twinkleSpeed[i] = 0.5 + Math.random() * 2.0;
  }

  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(twinklePhase, 1));
  starGeo.setAttribute('aSpeed', new THREE.BufferAttribute(twinkleSpeed, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size * window.devicePixelRatio * 80 },
    },
    vertexShader: `
      attribute float aOpacity;
      attribute float aPhase;
      attribute float aSpeed;
      uniform float uTime;
      uniform float uSize;
      varying float vOpacity;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize / -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        // Twinkle
        float twinkle = sin(uTime * aSpeed + aPhase) * 0.3 + 0.7;
        vOpacity = aOpacity * twinkle;
      }
    `,
    fragmentShader: `
      varying float vOpacity;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = 1.0 - smoothstep(0.0, 0.5, d);
        gl_FragColor = vec4(1.0, 1.0, 1.0, vOpacity * glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const stars = new THREE.Points(starGeo, starMat);
  state.scene.add(stars);

  // Store for animation
  if (!state.starLayers) state.starLayers = [];
  state.starLayers.push(stars);

  return stars;
}

function createNebulaCluster(center, color, count) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Gaussian-ish distribution around center
    const r = Math.random() * 8;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    positions[i * 3] = center.x + r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = center.y + r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = center.z + r * Math.cos(phi);
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: color,
    size: 0.08,
    transparent: true,
    opacity: 0.15,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  const cluster = new THREE.Points(geo, mat);
  state.scene.add(cluster);
  if (!state.nebulaClusters) state.nebulaClusters = [];
  state.nebulaClusters.push(cluster);
}

// ---- Shooting Stars / Meteors ----
function createShootingStars() {
  const count = 30; // meteor pool size
  const meteors = [];

  for (let i = 0; i < count; i++) {
    meteors.push(createOneMeteor(i, count));
  }

  state.meteors = meteors;
}

function createOneMeteor(index, total) {
  // Each meteor is a line with a glowing trail
  const tailSegments = 20;
  const positions = new Float32Array(tailSegments * 3);
  const alphas = new Float32Array(tailSegments);

  for (let i = 0; i < tailSegments; i++) {
    alphas[i] = 1.0 - i / tailSegments; // head=1, tail=0
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color().setHSL(0.55 + Math.random() * 0.15, 0.6, 0.8) },
    },
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const line = new THREE.Line(geo, mat);
  state.scene.add(line);

  // Meteor state — stagger start times so they don't all fire at once
  const meteor = {
    mesh: line,
    positions,
    tailSegments,
    // Current position & direction
    x: 0, y: 0, z: 0,
    dx: 0, dy: 0, dz: 0,
    speed: 0,
    life: 0,
    maxLife: 0,
    active: false,
    cooldown: Math.random() * 8 + index * 0.5, // staggered initial delay
  };

  resetMeteor(meteor);
  meteor.active = false; // start inactive with cooldown
  return meteor;
}

function resetMeteor(m) {
  // Random spawn position — closer to camera so they're visible
  const r = 4 + Math.random() * 10;
  const theta = Math.random() * Math.PI * 2;
  m.x = r * Math.cos(theta);
  m.y = 3 + Math.random() * 6; // spawn above center
  m.z = -(2 + Math.random() * 10); // in front of camera

  // Direction — generally falling diagonal
  const angle = Math.random() * Math.PI * 0.5 + Math.PI * 0.2;
  m.dx = Math.cos(angle) * (Math.random() > 0.5 ? 1 : -1);
  m.dy = -Math.abs(Math.sin(angle)); // always falling
  m.dz = (Math.random() - 0.5) * 0.3;

  m.speed = 12 + Math.random() * 20;
  m.life = 0;
  m.maxLife = 0.6 + Math.random() * 1.0;
  m.active = true;
}

function updateMeteors(dt) {
  if (!state.meteors) return;

  for (const m of state.meteors) {
    if (!m.active) {
      m.cooldown -= dt;
      if (m.cooldown <= 0) {
        resetMeteor(m);
      }
      // Hide trail
      for (let i = 0; i < m.tailSegments; i++) {
        m.positions[i * 3] = 0;
        m.positions[i * 3 + 1] = -999;
        m.positions[i * 3 + 2] = 0;
      }
      m.mesh.geometry.attributes.position.needsUpdate = true;
      continue;
    }

    m.life += dt;
    if (m.life >= m.maxLife) {
      m.active = false;
      m.cooldown = 2 + Math.random() * 6;
      continue;
    }

    // Move head
    m.x += m.dx * m.speed * dt;
    m.y += m.dy * m.speed * dt;
    m.z += m.dz * m.speed * dt;

    // Shift trail positions backward
    for (let i = m.tailSegments - 1; i > 0; i--) {
      m.positions[i * 3] = m.positions[(i - 1) * 3];
      m.positions[i * 3 + 1] = m.positions[(i - 1) * 3 + 1];
      m.positions[i * 3 + 2] = m.positions[(i - 1) * 3 + 2];
    }
    // Head position
    m.positions[0] = m.x;
    m.positions[1] = m.y;
    m.positions[2] = m.z;

    m.mesh.geometry.attributes.position.needsUpdate = true;

    // Fade out near end of life
    const fadeOut = m.life > m.maxLife * 0.7
      ? 1.0 - (m.life - m.maxLife * 0.7) / (m.maxLife * 0.3)
      : 1.0;
    m.mesh.material.uniforms.uColor.value.setHSL(
      0.55 + Math.random() * 0.01, 0.6, 0.7 * fadeOut + 0.1
    );
  }
}

// ---- Atmosphere Glow ----
function createAtmosphere() {
  const geometry = new THREE.SphereGeometry(1.15, 32, 32);
  const material = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
        gl_FragColor = vec4(0.37, 0.65, 0.98, 1.0) * intensity * 0.8;
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
  });

  const atmosphere = new THREE.Mesh(geometry, material);
  state.scene.add(atmosphere);
}

// ---- Simple 3D Noise ----
function simplex3D(x, y, z) {
  // Simple value noise fallback
  const p = (Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;
  const q = (Math.sin(x * 4.898 + y * 7.23 + z * 13.72) * 23421.631) % 1;
  return (p + q) / 2 - 0.5;
}

// ============================================================
//  2. ANIMATION LOOP
// ============================================================

function animate() {
  requestAnimationFrame(animate);

  const time = performance.now() * 0.001; // seconds

  if (state.globe) {
    // Auto-rotate when no gesture
    if (!state.handDetected && !state.isDragging) {
      state.targetRotY += state.autoRotateSpeed;
    }

    // Smooth interpolation (lerp)
    state.rotX += (state.targetRotX - state.rotX) * 0.08;
    state.rotY += (state.targetRotY - state.rotY) * 0.08;
    state.zoom += (state.targetZoom - state.zoom) * 0.08;

    state.globe.rotation.x = state.rotX;
    state.globe.rotation.y = state.rotY;
    state.camera.position.z = state.zoom;

    // Animate star layers — gentle rotation + twinkling
    if (state.starLayers) {
      state.starLayers.forEach((layer, idx) => {
        const speed = 0.00008 * (idx + 1);
        layer.rotation.y += speed;
        layer.rotation.x += speed * 0.3;
        // Update twinkle time uniform
        if (layer.material.uniforms && layer.material.uniforms.uTime) {
          layer.material.uniforms.uTime.value = time;
        }
      });
    }

    // Animate nebula clusters — slow drift
    if (state.nebulaClusters) {
      state.nebulaClusters.forEach((cluster, idx) => {
        cluster.rotation.y += 0.00015;
        cluster.rotation.x = Math.sin(time * 0.1 + idx * 2) * 0.02;
      });
    }

    // Animate shooting stars
    const dt = Math.min(0.05, 1 / 60); // cap delta to avoid jumps
    updateMeteors(dt);
  }

  // Update UI
  const angleDeg = ((state.rotY * 180 / Math.PI) % 360).toFixed(0);
  rotationAngle.textContent = angleDeg + '°';
  zoomLevel.textContent = (2.8 / state.zoom).toFixed(1) + 'x';

  state.renderer.render(state.scene, state.camera);
}

// ============================================================
//  3. MOUSE / TOUCH FALLBACK CONTROLS
// ============================================================

function initMouseControls() {
  canvas.addEventListener('mousedown', (e) => {
    state.isDragging = true;
    state.lastMouse.x = e.clientX;
    state.lastMouse.y = e.clientY;
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    const dx = e.clientX - state.lastMouse.x;
    const dy = e.clientY - state.lastMouse.y;
    state.targetRotY += dx * 0.005;
    state.targetRotX += dy * 0.005;
    // Clamp vertical rotation
    state.targetRotX = Math.max(-1.2, Math.min(1.2, state.targetRotX));
    state.lastMouse.x = e.clientX;
    state.lastMouse.y = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    state.isDragging = false;
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.targetZoom += e.deltaY * 0.002;
    state.targetZoom = Math.max(1.5, Math.min(6, state.targetZoom));
  }, { passive: false });

  canvas.style.cursor = 'grab';

  // Touch support
  let lastTouchDist = null;
  let lastTouchPos = null;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    }
  });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && lastTouchPos) {
      const dx = e.touches[0].clientX - lastTouchPos.x;
      const dy = e.touches[0].clientY - lastTouchPos.y;
      state.targetRotY += dx * 0.005;
      state.targetRotX += dy * 0.005;
      state.targetRotX = Math.max(-1.2, Math.min(1.2, state.targetRotX));
      lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && lastTouchDist !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = (lastTouchDist - dist) * 0.01;
      state.targetZoom += delta;
      state.targetZoom = Math.max(1.5, Math.min(6, state.targetZoom));
      lastTouchDist = dist;
    }
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    lastTouchDist = null;
    lastTouchPos = null;
  });
}

// ============================================================
//  4. MEDIAPIPE HANDS
// ============================================================

async function initHandTracking() {
  const hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
    }
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5,
  });

  hands.onResults(onHandResults);
  state.hands = hands;

  // Start camera
  const camera2 = new Camera(webcamEl, {
    onFrame: async () => {
      await hands.send({ image: webcamEl });
    },
    width: 320,
    height: 240,
  });

  await camera2.start();
  state.camera2 = camera2;

  // Update UI
  camStatus.textContent = 'LIVE';
  camStatus.classList.add('live');
  detectionStatus.innerHTML = '<span class="status-dot online"></span>已启动';

  // Resize overlay
  handOverlay.width = 320;
  handOverlay.height = 240;
}

function onHandResults(results) {
  // Draw hand landmarks on overlay
  const ctx = handOverlay.getContext('2d');
  ctx.clearRect(0, 0, handOverlay.width, handOverlay.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    state.handDetected = true;
    const landmarks = results.multiHandLandmarks[0];

    // Draw connections
    drawHandLandmarks(ctx, landmarks);

    // Recognize gesture
    recognizeGesture(landmarks);
  } else {
    state.handDetected = false;
    state.prevPalmPos = null;
    state.prevPalmSize = null;
    state.currentGesture = 'none';
    gestureType.textContent = '—';
  }
}

function drawHandLandmarks(ctx, landmarks) {
  const w = handOverlay.width;
  const h = handOverlay.height;

  // Draw connections
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17]
  ];

  ctx.strokeStyle = 'rgba(96, 165, 250, 0.5)';
  ctx.lineWidth = 2;

  for (const [a, b] of connections) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
    ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
    ctx.stroke();
  }

  // Draw points
  for (let i = 0; i < landmarks.length; i++) {
    const x = landmarks[i].x * w;
    const y = landmarks[i].y * h;
    const r = [4, 8, 12, 16, 20].includes(i) ? 4 : 2;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = [4, 8].includes(i)
      ? 'rgba(167, 139, 250, 0.9)'
      : 'rgba(96, 165, 250, 0.8)';
    ctx.fill();
  }
}

// ============================================================
//  5. GESTURE RECOGNITION
// ============================================================

function recognizeGesture(landmarks) {
  // Key landmarks:
  // 4 = thumb tip, 8 = index tip, 12 = middle tip
  // 0 = wrist, 5 = index MCP, 17 = pinky MCP

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const wrist = landmarks[0];

  // --- Palm size = proxy for hand-to-camera distance ---
  // Wrist(0) to middle fingertip(12): larger = closer to camera
  const palmSize = dist2D(wrist, middleTip);

  // --- Check if hand is open (all fingers extended) ---
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const middleExtended = landmarks[12].y < landmarks[10].y;
  const ringExtended = landmarks[16].y < landmarks[14].y;
  const pinkyExtended = landmarks[20].y < landmarks[18].y;
  const allExtended = indexExtended && middleExtended && ringExtended && pinkyExtended;

  if (allExtended) {
    // ---- OPEN PALM: Rotate + Zoom by distance ----
    state.currentGesture = 'palm';
    gestureType.textContent = '🖐️ 手掌控制';

    const palmX = (landmarks[0].x + landmarks[5].x + landmarks[17].x) / 3;
    const palmY = (landmarks[0].y + landmarks[5].y + landmarks[17].y) / 3;

    // Rotation: palm position
    if (state.prevPalmPos !== null) {
      const dx = (palmX - state.prevPalmPos.x) * 5;
      const dy = (palmY - state.prevPalmPos.y) * 5;
      state.targetRotY -= dx; // Mirrored because webcam is flipped
      state.targetRotX += dy;
      state.targetRotX = Math.max(-1.2, Math.min(1.2, state.targetRotX));
    }
    state.prevPalmPos = { x: palmX, y: palmY };

    // Zoom: palm size (closer = bigger = zoom in)
    if (state.prevPalmSize !== null) {
      const delta = (palmSize - state.prevPalmSize) * 8;
      state.targetZoom -= delta; // closer (larger) → smaller zoom value → zoom in
      state.targetZoom = Math.max(1.5, Math.min(6, state.targetZoom));
    }
    state.prevPalmSize = palmSize;

  } else {
    state.currentGesture = 'none';
    gestureType.textContent = '✋ 识别中…';
    state.prevPalmPos = null;
    state.prevPalmSize = null;
  }
}

function dist2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ============================================================
//  6. STARTUP
// ============================================================

// Init Three.js immediately
initScene();
initMouseControls();

// Handle window resize
window.addEventListener('resize', () => {
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start button
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.innerHTML = '<span>启动中…</span>';

  try {
    await initHandTracking();
    startOverlay.classList.add('hidden');

    // Hide instruction tip after a while
    setTimeout(() => {
      instructionTip.style.opacity = '0';
      instructionTip.style.transform = 'translateX(-50%) translateY(8px)';
      setTimeout(() => { instructionTip.style.display = 'none'; }, 400);
    }, 8000);
  } catch (err) {
    console.error('Camera error:', err);
    startBtn.innerHTML = '<span>摄像头启动失败，请重试</span>';
    startBtn.disabled = false;
    detectionStatus.innerHTML = '<span class="status-dot offline"></span>启动失败';
  }
});
