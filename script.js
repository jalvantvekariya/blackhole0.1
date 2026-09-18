/**
 * Relativistic Black Hole Simulation (Kerr Ray-Marching Engine)
 * Pure WebGL / Shader-based implementation via Three.js
 */

// --- Physical Constants (SI Units) ---
const G = 6.67430e-11;
const C = 299792458.0;
const SOLAR_MASS = 1.98847e30;
const BOLTZMANN = 1.380649e-23;

// --- GLSL Shaders ---

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec2 u_resolution;
  uniform vec3 u_cameraPos;
  uniform vec3 u_cameraLookAt;
  uniform float u_time;

  // Simulation Uniforms
  uniform float u_mass;          // Solar masses
  uniform float u_spin;          // Kerr parameter a* (0.0 to 0.998)
  uniform float u_accretion;     // Density / accretion rate factor
  uniform int u_filterMode;      // 0: Normal, 1: X-Ray, 2: Temp, 3: Press, 4: Density, 5: Gravity, 6: Velocity, 7: Spacetime, 8: Magnetic
  uniform int u_maxSteps;        // Ray quality step count limit
  uniform bool u_enableJets;     // Jet visualization

  varying vec2 vUv;

  #define PI 3.14159265359

  // --- Procedural Noise Functions for Plasma Turbulence ---
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C_s = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C_s.yyy) );
    vec3 x0 = v - i + dot(i, C_s.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C_s.xxx;
    vec3 x2 = x0 - i2 + C_s.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute( permute( permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }

  // Multi-frequency plasma turbulence noise
  float plasmaTurbulence(vec3 p) {
    float f = 0.0;
    f += 0.5000 * snoise(p); p *= 2.02;
    f += 0.2500 * snoise(p); p *= 2.03;
    f += 0.1250 * snoise(p); p *= 2.01;
    f += 0.0625 * snoise(p);
    return f;
  }

  // Compute Kerr Inner Stable Circular Orbit (ISCO) in geometric units (r_g)
  float calculateISCO(float a) {
    float Z1 = 1.0 + pow(1.0 - a*a, 1.0/3.0) * (pow(1.0 + a, 1.0/3.0) + pow(1.0 - a, 1.0/3.0));
    float Z2 = sqrt(3.0 * a * a + Z1 * Z1);
    return 3.0 + Z2 - sqrt((3.0 - Z1) * (3.0 + Z1 + 2.0 * Z2));
  }

  // Color temperature mapping for hot plasma
  vec3 temperatureToColor(float temp) {
    float t = clamp(temp, 0.0, 1.0);
    vec3 c1 = vec3(0.15, 0.01, 0.0);  // Dark reddish-orange (cooler outer disk)
    vec3 c2 = vec3(1.0, 0.35, 0.02);  // Bright amber plasma
    vec3 c3 = vec3(1.0, 0.9, 0.4);    // Hot yellow-white
    vec3 c4 = vec3(0.7, 0.85, 1.0);   // Extremely hot blue-white inner edge
    
    if (t < 0.33) return mix(c1, c2, t / 0.33);
    if (t < 0.66) return mix(c2, c3, (t - 0.33) / 0.33);
    return mix(c3, c4, (t - 0.66) / 0.34);
  }

  // Scientific Heatmap Color Palette for Analysis Filters
  vec3 heatmapColor(float val) {
    float v = clamp(val, 0.0, 1.0);
    return mix(vec3(0.0, 0.0, 0.4), mix(vec3(0.0, 0.8, 1.0), mix(vec3(0.9, 0.9, 0.0), vec3(1.0, 0.0, 0.0), step(0.66, v)), step(0.33, v)), step(0.0, v));
  }

  // Starfield background lensing calculation
  vec3 getStarfield(vec3 dir) {
    float n = snoise(dir * 120.0);
    float star = pow(clamp(n, 0.0, 1.0), 30.0) * 2.5;
    vec3 col = vec3(star);
    // Subtle color variation
    col *= vec3(0.8 + 0.4 * snoise(dir * 10.0), 0.9, 1.1 - 0.2 * snoise(dir * 5.0));
    return col;
  }

  void main() {
    vec2 st = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;

    // --- Camera Ray Setup ---
    vec3 ww = normalize(u_cameraLookAt - u_cameraPos);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(st.x * uu + st.y * vv + 1.8 * ww);
    vec3 pos = u_cameraPos;

    // --- Relativistic Metric Setup ---
    float rg = 1.0; // Schwarzschild radius normalized to 1 unit in shader
    float r_horizon = 0.5 * (1.0 + sqrt(1.0 - u_spin * u_spin)) * rg;
    float r_isco = calculateISCO(u_spin) * 0.5 * rg; // Inner disk cutoff
    float r_outer = 8.5 * rg;

    vec3 accumColor = vec3(0.0);
    float accumOpacity = 0.0;
    float stepSize = 0.08;

    // Photon ring orbit accumulator
    float photonRingGlow = 0.0;

    // Frame-dragging parameter
    float frameDrag = u_spin * 0.15;

    // --- Numerical Ray Integration (Null Geodesic Approximation) ---
    bool hitHorizon = false;

    for (int i = 0; i < 300; i++) {
      if (i >= u_maxSteps) break;

      float r = length(pos);

      // Check Event Horizon intersection
      if (r < r_horizon) {
        hitHorizon = true;
        break;
      }

      // Ray escaped to deep space background
      if (r > 25.0) {
        accumColor += (1.0 - accumOpacity) * getStarfield(rd);
        break;
      }

      // --- Gravitational Ray Deflection Vector Calculation ---
      // Force equation inspired by pseudo-Newtonian Kerr potential
      float force = (1.5 * rg) / (r * r * r);
      vec3 accel = -force * pos;

      // Kerr frame-dragging rotation vector adjustment around Z axis
      vec3 dragVec = cross(vec3(0.0, 1.0, 0.0), pos) * (frameDrag / (r * r * r));
      accel += dragVec;

      // Update ray direction and position
      rd = normalize(rd + accel * stepSize);
      pos += rd * stepSize;

      // --- Photon Ring Intensity Accumulation ---
      // Critical photon orbit region roughly around 1.3 to 1.6 r_g
      float photonRadius = 1.35 * rg;
      float dPhoton = abs(r - photonRadius);
      if (dPhoton < 0.2) {
        photonRingGlow += pow(1.0 - dPhoton / 0.2, 2.0) * 0.015;
      }

      // --- Accretion Disk Volumetric Intersection ---
      float diskThickness = 0.12 * (r / rg); // Vertical Gaussian envelope height
      if (abs(pos.y) < diskThickness && r >= r_isco && r <= r_outer) {
        
        // Normalize radial position [0.0 - 1.0] across disk width
        float normR = (r - r_isco) / (r_outer - r_isco);
        
        // Polar coordinates for orbital rotation
        float phi = atan(pos.z, pos.x);
        float omega = 1.5 / (pow(r, 1.5) + 0.1); // Keplerian orbital angular speed
        float rotPhi = phi - u_time * omega * 1.2;

        // Plasma density distribution
        vec3 samplePos = vec3(r * cos(rotPhi), pos.y * 3.0, r * sin(rotPhi));
        float noiseVal = plasmaTurbulence(samplePos * 1.5);
        
        // Vertical Gaussian density falloff
        float verticalDensity = exp(-0.5 * pow(pos.y / (diskThickness * 0.5), 2.0));
        
        // Radial density profile: sharp inner edge, smooth outer attenuation
        float radialDensity = pow(1.0 - normR, 1.5) * smoothstep(0.0, 0.1, normR);
        
        float localDensity = (0.4 + 0.6 * noiseVal) * verticalDensity * radialDensity * u_accretion;

        if (localDensity > 0.001) {
          // --- Relativistic Doppler & Beaming Effect ---
          // Orbital speed vector v_phi tangent to rotation
          vec3 vOrbital = normalize(vec3(-pos.z, 0.0, pos.x));
          float vMag = clamp(sqrt(0.5 * rg / r), 0.0, 0.75);
          float cosTheta = dot(rd, vOrbital);
          
          // Doppler shift factor delta = 1 / (gamma * (1 - v/c * cos(theta)))
          float gammaRel = 1.0 / sqrt(1.0 - vMag * vMag);
          float dopplerShift = 1.0 / (gammaRel * (1.0 - vMag * cosTheta));
          
          // Relativistic intensity boosting (I = I0 * delta^4)
          float beaming = pow(dopplerShift, 3.5);

          // --- Local Temperature & Physical Quantities ---
          float T_local = pow(r_isco / r, 0.75) * dopplerShift; // Shakura-Sunyaev temperature profile
          float pressure = localDensity * T_local;
          float gravityField = 1.0 / (r * r);

          vec3 stepColor = vec3(0.0);

          // --- Filter Rendering Modes ---
          if (u_filterMode == 0) {
            // NORMAL: Realistically boosted hot plasma emission
            vec3 baseTempColor = temperatureToColor(T_local * 0.8);
            stepColor = baseTempColor * beaming * localDensity * 2.5;
          } else if (u_filterMode == 1) {
            // X-RAY: Intense high-energy inner disk & jet region
            float xRayIntensity = pow(T_local, 2.0) * localDensity * beaming;
            stepColor = mix(vec3(0.0, 0.2, 0.8), vec3(0.9, 0.95, 1.0), xRayIntensity) * xRayIntensity * 3.0;
          } else if (u_filterMode == 2) {
            // TEMPERATURE HEATMAP
            stepColor = heatmapColor(T_local) * localDensity * 3.0;
          } else if (u_filterMode == 3) {
            // PRESSURE
            stepColor = heatmapColor(pressure) * localDensity * 3.0;
          } else if (u_filterMode == 4) {
            // DENSITY
            stepColor = heatmapColor(localDensity) * 3.0;
          } else if (u_filterMode == 5) {
            // GRAVITY FIELD
            stepColor = heatmapColor(gravityField * 0.2) * 2.0;
          } else if (u_filterMode == 6) {
            // VELOCITY FIELD
            stepColor = heatmapColor(vMag / 0.75) * localDensity * 3.0;
          } else if (u_filterMode == 7) {
            // SPACETIME CURVATURE GRID OVERLAY
            float grid = abs(sin(r * 8.0)) * abs(sin(phi * 12.0));
            stepColor = vec3(0.1, 0.8, 1.0) * pow(grid, 4.0) * (1.0 / r);
          } else if (u_filterMode == 8) {
            // MAGNETIC FIELD LINES
            float fieldLine = pow(abs(sin(phi * 16.0 + r * 4.0)), 12.0);
            stepColor = vec3(0.2, 1.0, 0.5) * fieldLine * localDensity * 4.0;
          }

          // Volumetric alpha composite
          float deltaOpacity = (1.0 - accumOpacity) * clamp(localDensity * 0.3, 0.0, 1.0);
          accumColor += stepColor * deltaOpacity;
          accumOpacity += deltaOpacity;

          if (accumOpacity >= 0.98) break;
        }
      }

      // --- Relativistic Jets Visualization ---
      if (u_enableJets) {
        float jetRadius = 0.2 + 0.15 * abs(pos.y);
        float distToAxis = length(pos.xz);
        if (distToAxis < jetRadius && abs(pos.y) > r_horizon && abs(pos.y) < 12.0) {
          float jetTurbulence = snoise(vec3(pos.x * 2.0, pos.y * 0.5 - u_time * 4.0, pos.z * 2.0));
          float jetDensity = exp(-distToAxis / (jetRadius * 0.5)) * (0.5 + 0.5 * jetTurbulence);
          jetDensity *= (1.0 / (abs(pos.y) * 0.3 + 0.5));
          
          vec3 jetColor = mix(vec3(0.2, 0.5, 1.0), vec3(0.9, 0.95, 1.0), jetDensity);
          float jetAlpha = (1.0 - accumOpacity) * jetDensity * 0.05 * u_accretion;
          accumColor += jetColor * jetAlpha;
          accumOpacity += jetAlpha;
        }
      }

      // Step adaptive scaling
      stepSize = 0.04 + 0.03 * (r / rg);
    }

    // --- Final Color Assembly ---
    if (hitHorizon) {
      // Event Horizon core shadow (Absence of escaping light)
      accumColor = mix(accumColor, vec3(0.0), 1.0 - accumOpacity);
    } else {
      // Add delicate photon ring emission
      vec3 photonRingColor = vec3(1.0, 0.9, 0.75) * photonRingGlow * 3.5;
      accumColor += photonRingColor;
    }

    // High dynamic range tone mapping & gamma correction
    vec3 mapped = accumColor / (vec3(1.0) + accumColor); // Reinhard tone mapping
    mapped = pow(mapped, vec3(1.0 / 2.2));                // Gamma correction

    gl_FragColor = vec4(mapped, 1.0);
  }
`;

// --- Simulation Engine Class ---

class BlackHoleSimulation {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // Default Simulation State
    this.params = {
      mass: 10.0,
      spin: 0.900,
      accretion: 0.50,
      filterMode: 0,
      quality: 'HIGH',
      maxSteps: 220,
      jets: true
    };

    // Camera Orbit Controller state
    this.cameraState = {
      radius: 14.0,
      theta: 1.35, // Pitch angle
      phi: 0.4,    // Yaw angle
      isDragging: false,
      previousMousePosition: { x: 0, y: 0 }
    };

    this.initThree();
    this.initListeners();
    this.updateTelemetry();
    this.animate(0);
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.container.appendChild(this.renderer.domElement);

    this.uniforms = {
      u_resolution: { value: new THREE.Vector2(this.width, this.height) },
      u_cameraPos: { value: new THREE.Vector3() },
      u_cameraLookAt: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
      u_time: { value: 0.0 },
      u_mass: { value: this.params.mass },
      u_spin: { value: this.params.spin },
      u_accretion: { value: this.params.accretion },
      u_filterMode: { value: this.params.filterMode },
      u_maxSteps: { value: this.params.maxSteps },
      u_enableJets: { value: this.params.jets }
    };

    const geometry = new THREE.PlaneBufferGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      uniforms: this.uniforms,
      depthWrite: false,
      depthTest: false
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    this.updateCameraPosition();
  }

  updateCameraPosition() {
    const { radius, theta, phi } = this.cameraState;
    const x = radius * Math.sin(theta) * Math.cos(phi);
    const y = radius * Math.cos(theta);
    const z = radius * Math.sin(theta) * Math.sin(phi);

    this.uniforms.u_cameraPos.value.set(x, y, z);
  }

  calculateISCO(a) {
    const Z1 = 1.0 + Math.pow(1.0 - a * a, 1.0 / 3.0) * (Math.pow(1.0 + a, 1.0 / 3.0) + Math.pow(1.0 - a, 1.0 / 3.0));
    const Z2 = Math.sqrt(3.0 * a * a + Z1 * Z1);
    return 3.0 + Z2 - Math.sqrt((3.0 - Z1) * (3.0 + Z1 + 2.0 * Z2));
  }

  updateTelemetry() {
    const M = this.params.mass * SOLAR_MASS;
    const a = this.params.spin;

    // Schwarzschild radius Rs = 2GM / c^2
    const Rs = (2.0 * G * M) / (C * C);
    // Kerr ISCO radius
    const iscoFactor = this.calculateISCO(a);
    const R_isco = (iscoFactor * G * M) / (C * C);

    // Peak disk temperature (Shakura-Sunyaev model estimate)
    const T_max = 1.2e7 * Math.pow(10.0 / this.params.mass, 0.25) * Math.pow(this.params.accretion, 0.25) * (6.0 / iscoFactor);

    // Maximum orbital velocity v/c at ISCO
    const v_max = Math.sqrt((G * M) / (R_isco * C * C));

    // Gravitational Redshift factor gamma = 1 / sqrt(1 - 2GM / r c^2)
    const redshift = 1.0 / Math.sqrt(Math.max(0.01, 1.0 - (2.0 / iscoFactor)));

    // Maximum Surface Gravity at Horizon
    const surfaceG = (G * M) / (Rs * Rs);

    // DOM Updates
    document.getElementById('tel-rs').textContent = `${(Rs / 1000).toFixed(1)} km`;
    document.getElementById('tel-risco').textContent = `${(R_isco / 1000).toFixed(1)} km`;
    document.getElementById('tel-temp').textContent = `${T_max.toExponential(2)} K`;
    document.getElementById('tel-vel').textContent = `${v_max.toFixed(2)} c`;
    document.getElementById('tel-redshift').textContent = redshift.toFixed(2);
    document.getElementById('tel-gravity').textContent = `${surfaceG.toExponential(2)} m/s²`;
  }

  initListeners() {
    // Resize Handler
    window.addEventListener('resize', () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.renderer.setSize(this.width, this.height);
      this.uniforms.u_resolution.value.set(this.width, this.height);
    });

    // Orbit Controls via Canvas Drag
    const dom = this.renderer.domElement;

    dom.addEventListener('mousedown', (e) => {
      this.cameraState.isDragging = true;
      this.cameraState.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.cameraState.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.cameraState.isDragging) return;

      const deltaX = e.clientX - this.cameraState.previousMousePosition.x;
      const deltaY = e.clientY - this.cameraState.previousMousePosition.y;

      this.cameraState.phi -= deltaX * 0.005;
      this.cameraState.theta = Math.max(0.05, Math.min(Math.PI - 0.05, this.cameraState.theta - deltaY * 0.005));

      this.cameraState.previousMousePosition = { x: e.clientX, y: e.clientY };
      this.updateCameraPosition();
    });

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraState.radius = Math.max(4.0, Math.min(30.0, this.cameraState.radius + e.deltaY * 0.01));
      this.updateCameraPosition();
    }, { passive: false });

    // UI Input Binding
    document.getElementById('slider-mass').addEventListener('input', (e) => {
      this.params.mass = parseFloat(e.target.value);
      document.getElementById('val-mass').textContent = this.params.mass.toFixed(1);
      this.uniforms.u_mass.value = this.params.mass;
      this.updateTelemetry();
    });

    document.getElementById('slider-spin').addEventListener('input', (e) => {
      this.params.spin = parseFloat(e.target.value);
      document.getElementById('val-spin').textContent = this.params.spin.toFixed(3);
      this.uniforms.u_spin.value = this.params.spin;
      this.updateTelemetry();
    });

    document.getElementById('slider-accretion').addEventListener('input', (e) => {
      this.params.accretion = parseFloat(e.target.value);
      document.getElementById('val-accretion').textContent = this.params.accretion.toFixed(2);
      this.uniforms.u_accretion.value = this.params.accretion;
      this.updateTelemetry();
    });

    document.getElementById('toggle-jets').addEventListener('change', (e) => {
      this.params.jets = e.target.checked;
      this.uniforms.u_enableJets.value = this.params.jets;
    });

    // Camera Presets
    document.querySelectorAll('.btn-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const preset = e.target.dataset.preset;
        if (preset === 'orbit') {
          this.cameraState.theta = 1.35;
          this.cameraState.phi = 0.4;
          this.cameraState.radius = 14.0;
        } else if (preset === 'side') {
          this.cameraState.theta = Math.PI / 2.0 - 0.02;
          this.cameraState.phi = 0.0;
          this.cameraState.radius = 12.0;
        } else if (preset === 'top') {
          this.cameraState.theta = 0.08;
          this.cameraState.phi = 0.0;
          this.cameraState.radius = 15.0;
        }
        this.updateCameraPosition();
      });
    });

    // Quality Presets
    document.querySelectorAll('.btn-quality').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-quality').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const q = e.target.dataset.q;
        if (q === 'LOW') this.params.maxSteps = 80;
        if (q === 'MEDIUM') this.params.maxSteps = 140;
        if (q === 'HIGH') this.params.maxSteps = 220;
        if (q === 'ULTRA') this.params.maxSteps = 320;
        this.uniforms.u_maxSteps.value = this.params.maxSteps;
      });
    });

    // Filter Buttons
    const filterLabels = [
      "Mode: SIMULATED PLASMA EMISSION",
      "Mode: SIMULATED X-RAY EMISSION",
      "Mode: TEMPERATURE HEATMAP T(r)",
      "Mode: SIMULATED PLASMA PRESSURE P(r)",
      "Mode: ACCRETION DENSITY FIELD ρ(r)",
      "Mode: GRAVITATIONAL FIELD STRENGTH g(r)",
      "Mode: ORBITAL VELOCITY FIELD v/c",
      "Mode: CONCEPTUAL SPACETIME CURVATURE",
      "Mode: ILLUSTRATIVE MAGNETIC FIELD LINES"
    ];

    document.querySelectorAll('.btn-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const mode = parseInt(e.target.dataset.filter);
        this.params.filterMode = mode;
        this.uniforms.u_filterMode.value = mode;
        document.getElementById('rendering-mode-label').textContent = filterLabels[mode];
      });
    });

    // Modal Handlers
    document.getElementById('btn-about').addEventListener('click', () => {
      document.getElementById('modal-about').classList.remove('hidden');
    });

    document.getElementById('btn-close-modal').addEventListener('click', () => {
      document.getElementById('modal-about').classList.add('hidden');
    });

    // Reset Button
    document.getElementById('btn-reset').addEventListener('click', () => {
      this.params.mass = 10.0;
      this.params.spin = 0.900;
      this.params.accretion = 0.50;
      
      document.getElementById('slider-mass').value = 10.0;
      document.getElementById('val-mass').textContent = "10.0";
      document.getElementById('slider-spin').value = 0.900;
      document.getElementById('val-spin').textContent = "0.900";
      document.getElementById('slider-accretion').value = 0.50;
      document.getElementById('val-accretion').textContent = "0.50";

      this.uniforms.u_mass.value = 10.0;
      this.uniforms.u_spin.value = 0.900;
      this.uniforms.u_accretion.value = 0.50;

      this.cameraState.radius = 14.0;
      this.cameraState.theta = 1.35;
      this.cameraState.phi = 0.4;

      this.updateCameraPosition();
      this.updateTelemetry();
    });
  }

  animate(timestamp) {
    requestAnimationFrame((t) => this.animate(t));

    // Update uniform time for plasma flow animation
    this.uniforms.u_time.value = timestamp * 0.001;

    this.renderer.render(this.scene, this.camera);
  }
}

// Instantiate simulation on DOM load
window.addEventListener('DOMContentLoaded', () => {
  new BlackHoleSimulation();
});
