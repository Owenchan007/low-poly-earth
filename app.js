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
  // Planet seed: ?seed=123 in the URL reproduces a planet, otherwise random
  seed: Number.parseInt(new URLSearchParams(location.search).get('seed'), 10)
    || Math.floor(Math.random() * 1e9),
  clock: null,
  // Gesture
  handDetected: false,
  currentGesture: 'none', // 'none' | 'palm'
  // Globe transform
  targetRotX: 0.3,
  targetRotY: 0,
  rotX: 0.3,
  rotY: 0,
  autoRotateSpeed: 0.12, // rad/s
  targetZoom: 2.8,
  zoom: 2.8,
  // Mouse fallback
  isDragging: false,
  lastMouse: { x: 0, y: 0 },
  // Palm tracking (exponentially smoothed to suppress landmark jitter)
  smoothPalm: null,   // { x, y, size }
  prevPalmPos: null,
  prevPalmSize: null, // for zoom by palm distance
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
  state.clock = new THREE.Clock();
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
  fitCameraToViewport();

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
// Terrain is driven by seeded 3D Perlin fBm so land forms coherent continents.
// Append ?seed=123 to the URL to get the same planet every time.
const SEA_LEVEL = 0.1;

function createGlobe() {
  const detail = 12; // r125+ subdivides linearly: 20 * (detail + 1)^2 faces ≈ 3.4k
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const positions = geometry.attributes.position;
  const vertex = new THREE.Vector3();

  const elevation = createFbm(state.seed, 5);          // continents + detail
  const moisture = createFbm(state.seed + 1013, 3);    // deserts vs forests
  const rand = mulberry32(state.seed + 7);

  // Displace vertices: land rises above sea level, oceans stay a smooth shell.
  // The geometry is non-indexed, but shared corners get identical positions and
  // therefore identical noise, so the surface stays watertight.
  const heights = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).normalize();
    const h = elevation(vertex.x * 1.6, vertex.y * 1.6, vertex.z * 1.6);
    heights[i] = h;
    const radius = h > SEA_LEVEL ? 1.0 + (h - SEA_LEVEL) * 0.13 : 1.0 - 0.01;
    vertex.multiplyScalar(radius);
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const palettes = {
    deepOcean: ['#0c2d5a', '#0f3a6e', '#123f7a', '#1e3a8a', '#0c4a6e'],
    ocean: ['#1d4ed8', '#1e40af', '#2563eb', '#0369a1', '#0284c7'],
    shallow: ['#0ea5e9', '#38bdf8', '#22a6d6', '#3b82f6'],
    beach: ['#fde68a', '#fcd34d', '#fef3c7'],
    desert: ['#fbbf24', '#f59e0b', '#fcd34d', '#d97706', '#e8b04b'],
    grass: ['#4ade80', '#86efac', '#a3e635', '#6ee7b7', '#34d399'],
    forest: ['#16a34a', '#15803d', '#059669', '#10b981', '#22c55e'],
    rock: ['#78716c', '#a8a29e', '#8b7d6b', '#6b7280'],
    snow: ['#f8fafc', '#e2e8f0', '#f1f5f9', '#dbeafe', '#e0e7ff'],
  };

  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const c = new THREE.Vector3();

  for (let i = 0; i < positions.count; i += 3) {
    c.set(0, 0, 0);
    for (let j = 0; j < 3; j++) {
      c.x += positions.getX(i + j); c.y += positions.getY(i + j); c.z += positions.getZ(i + j);
    }
    c.normalize();
    const h = (heights[i] + heights[i + 1] + heights[i + 2]) / 3;
    const lat = Math.abs(Math.asin(c.y));              // 0 (equator) .. π/2 (pole)
    const wet = moisture(c.x * 2.2, c.y * 2.2, c.z * 2.2);
    const cold = lat + (h > SEA_LEVEL ? (h - SEA_LEVEL) * 1.5 : 0) + wet * 0.15;

    let palette;
    if (cold > 1.3) palette = palettes.snow;                       // polar caps / peaks
    else if (h < SEA_LEVEL - 0.22) palette = palettes.deepOcean;
    else if (h < SEA_LEVEL - 0.07) palette = palettes.ocean;
    else if (h < SEA_LEVEL) palette = palettes.shallow;
    else if (h < SEA_LEVEL + 0.03) palette = palettes.beach;
    else if (h > SEA_LEVEL + 0.38) palette = palettes.rock;
    else if (lat < 0.55 && wet < -0.08) palette = palettes.desert;
    else if (wet > 0.05 || h > SEA_LEVEL + 0.2) palette = palettes.forest;
    else palette = palettes.grass;

    color.set(palette[Math.floor(rand() * palette.length)]);
    color.offsetHSL(0, 0, (rand() - 0.5) * 0.06);

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
  state.globe.rotation.x = state.rotX;
  state.scene.add(state.globe);

  // Wireframe overlay (subtle) — shares the globe's geometry instead of cloning it
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.03,
  });
  state.globe.add(new THREE.Mesh(geometry, wireMat));
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
      uSize: { value: size * Math.min(window.devicePixelRatio, 2) * 80 },
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
    hue: 0.55 + Math.random() * 0.15,
    cooldown: Math.random() * 8 + index * 0.5, // staggered initial delay
  };

  line.visible = false; // start inactive with cooldown
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

  // Collapse the whole trail onto the spawn point so it grows out of the head
  // instead of streaking in from wherever the previous meteor ended.
  for (let i = 0; i < m.tailSegments; i++) {
    m.positions[i * 3] = m.x;
    m.positions[i * 3 + 1] = m.y;
    m.positions[i * 3 + 2] = m.z;
  }
  m.mesh.geometry.attributes.position.needsUpdate = true;
  m.mesh.visible = true;
}

function updateMeteors(dt) {
  if (!state.meteors) return;

  for (const m of state.meteors) {
    if (!m.active) {
      m.cooldown -= dt;
      if (m.cooldown <= 0) resetMeteor(m);
      continue;
    }

    m.life += dt;
    if (m.life >= m.maxLife) {
      m.active = false;
      m.mesh.visible = false;
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
    m.mesh.material.uniforms.uColor.value.setHSL(m.hue, 0.6, 0.7 * fadeOut + 0.1);
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

// ---- Seeded 3D Perlin noise ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function createPerlin3D(seed) {
  const rand = mulberry32(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => {
    const g = GRAD3[h % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  };

  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
           lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
           lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w
    );
  };
}

// Fractal Brownian motion: layered octaves of Perlin noise, roughly in [-1, 1]
function createFbm(seed, octaves) {
  const noise = createPerlin3D(seed);
  return (x, y, z) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq, y * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.0;
    }
    return sum / norm * 1.6;
  };
}

// ============================================================
//  2. ANIMATION LOOP
// ============================================================

function animate() {
  requestAnimationFrame(animate);

  // Frame-rate independent timing (same feel on 60 Hz and 120 Hz screens);
  // dt is capped so returning to a background tab doesn't cause a jump.
  const dt = Math.min(state.clock.getDelta(), 0.05);
  const time = state.clock.elapsedTime;

  if (state.globe) {
    // Auto-rotate when no gesture
    if (!state.handDetected && !state.isDragging) {
      state.targetRotY += state.autoRotateSpeed * dt;
    }

    // Exponential smoothing — equivalent to lerp(0.08) per frame at 60 fps
    const k = 1 - Math.exp(-5 * dt);
    state.rotX += (state.targetRotX - state.rotX) * k;
    state.rotY += (state.targetRotY - state.rotY) * k;
    state.zoom += (state.targetZoom - state.zoom) * k;

    state.globe.rotation.x = state.rotX;
    state.globe.rotation.y = state.rotY;
    state.camera.position.z = state.zoom;

    // Animate star layers — gentle rotation + twinkling
    if (state.starLayers) {
      state.starLayers.forEach((layer, idx) => {
        const speed = 0.0048 * (idx + 1) * dt;
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
        cluster.rotation.y += 0.009 * dt;
        cluster.rotation.x = Math.sin(time * 0.1 + idx * 2) * 0.02;
      });
    }

    // Animate shooting stars
    updateMeteors(dt);
  }

  // Update UI
  const angleDeg = ((((state.rotY * 180) / Math.PI) % 360 + 360) % 360).toFixed(0);
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
    resetPalmTracking();
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

// A finger counts as extended when its tip is clearly farther from the wrist
// than its middle (PIP) joint. Unlike comparing y-coordinates, this works no
// matter how the hand is rotated or tilted.
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [tip, pip]

function isFingerExtended(landmarks, tip, pip) {
  const wrist = landmarks[0];
  return dist2D(wrist, landmarks[tip]) > dist2D(wrist, landmarks[pip]) * 1.1;
}

function resetPalmTracking() {
  state.smoothPalm = null;
  state.prevPalmPos = null;
  state.prevPalmSize = null;
}

function recognizeGesture(landmarks) {
  // Key landmarks: 0 = wrist, 5 = index MCP, 9 = middle MCP, 17 = pinky MCP
  const allExtended = FINGERS.every(([tip, pip]) => isFingerExtended(landmarks, tip, pip));

  if (!allExtended) {
    state.currentGesture = 'none';
    gestureType.textContent = '✋ 识别中…';
    resetPalmTracking();
    return;
  }

  // ---- OPEN PALM: Rotate + Zoom by distance ----
  state.currentGesture = 'palm';
  gestureType.textContent = '🖐️ 手掌控制';

  const raw = {
    x: (landmarks[0].x + landmarks[5].x + landmarks[17].x) / 3,
    y: (landmarks[0].y + landmarks[5].y + landmarks[17].y) / 3,
    // Wrist → middle-finger MCP: a palm-size proxy for distance to the camera
    // that doesn't change when the fingers bend slightly.
    size: dist2D(landmarks[0], landmarks[9]),
  };

  // Exponential smoothing removes frame-to-frame landmark jitter
  const a = 0.45;
  const p = state.smoothPalm
    ? {
        x: state.smoothPalm.x + (raw.x - state.smoothPalm.x) * a,
        y: state.smoothPalm.y + (raw.y - state.smoothPalm.y) * a,
        size: state.smoothPalm.size + (raw.size - state.smoothPalm.size) * a,
      }
    : raw;
  state.smoothPalm = p;

  // Rotation: palm movement (ignore sub-pixel jitter)
  if (state.prevPalmPos !== null) {
    const dx = p.x - state.prevPalmPos.x;
    const dy = p.y - state.prevPalmPos.y;
    if (Math.abs(dx) > 0.001) state.targetRotY -= dx * 5; // mirrored: webcam is flipped
    if (Math.abs(dy) > 0.001) state.targetRotX += dy * 5;
    state.targetRotX = Math.max(-1.2, Math.min(1.2, state.targetRotX));
  }
  state.prevPalmPos = { x: p.x, y: p.y };

  // Zoom: relative palm-size change (closer = bigger = zoom in)
  if (state.prevPalmSize !== null && state.prevPalmSize > 0) {
    const ratio = p.size / state.prevPalmSize - 1;
    if (Math.abs(ratio) > 0.004) {
      state.targetZoom -= ratio * 4;
      state.targetZoom = Math.max(1.5, Math.min(6, state.targetZoom));
    }
  }
  state.prevPalmSize = p.size;
}

function dist2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// On portrait screens (phones) a fixed vertical FOV would crop the globe at the
// sides, so widen the vertical FOV until the horizontal FOV matches desktop's.
const BASE_FOV = 55;
function fitCameraToViewport() {
  const aspect = window.innerWidth / window.innerHeight;
  state.camera.aspect = aspect;
  state.camera.fov = aspect >= 1
    ? BASE_FOV
    : 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / aspect));
  state.camera.updateProjectionMatrix();
}

// ============================================================
//  6. STARTUP
// ============================================================

// Init Three.js immediately
initScene();
initMouseControls();

// Handle window resize
window.addEventListener('resize', () => {
  fitCameraToViewport();
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(window.innerWidth, window.innerHeight);
});

// Touch devices get touch instructions instead of mouse ones
if (window.matchMedia('(pointer: coarse)').matches) {
  instructionTip.querySelector('span').textContent = '也可以单指拖动旋转 · 双指捏合缩放';
}

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
      instructionTip.style.transform = 'translateY(8px)';
      setTimeout(() => { instructionTip.style.display = 'none'; }, 400);
    }, 8000);
  } catch (err) {
    console.error('Camera error:', err);
    startBtn.innerHTML = '<span>摄像头启动失败，请重试</span>';
    startBtn.disabled = false;
    detectionStatus.innerHTML = '<span class="status-dot offline"></span>启动失败';
  }
});
