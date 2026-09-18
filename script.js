// --- SETUP & STATE ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 8, 30);

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Performance optimization
container.appendChild(renderer.domElement);

// Controls setup
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 100;
controls.minDistance = 5;

// Global simulation state (matches your UI parameters)
const state = {
    spin: 0.985,
    mass: 10.0,
    simSpeed: 1.0,
    accretionRate: 0.5,
    jetsEnabled: true,
    activeFilter: 'NORMAL'
};

const FILTER_MODES = {
    NORMAL: { innerColor: [1.0, 0.85, 0.6], outerColor: [0.8, 0.2, 0.05] },
    XRAY: { innerColor: [0.4, 0.8, 1.0], outerColor: [0.1, 0.2, 0.5] }
};

let accretionDiskMesh;
let jetMesh;
let blackHoleMesh;
const clock = new THREE.Clock();

// --- 1. BLACK HOLE (Event Horizon Shadow) ---
function createBlackHole() {
    const geometry = new THREE.SphereGeometry(2.0, 64, 64);
    
    // Basic shader to represent the void/lensing zone to prevent crashes 
    // when the animate loop updates its uniforms
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uMass: { value: state.mass }
        },
        vertexShader: `
            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            void main() {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Pure black event horizon
            }
        `
    });
    
    blackHoleMesh = new THREE.Mesh(geometry, material);
    scene.add(blackHoleMesh);
}

// --- 2. SMOOTH ACCRETION DISK SHADER ---
function createAccretionDisk() {
    if (accretionDiskMesh) {
        scene.remove(accretionDiskMesh);
        accretionDiskMesh.geometry.dispose();
        accretionDiskMesh.material.dispose();
    }

    const geometry = new THREE.PlaneGeometry(28, 28, 64, 64);
    geometry.rotateX(-Math.PI / 2); // Lay flat on XZ plane

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uSpin: { value: state.spin },
            uCamPos: { value: new THREE.Vector3() },
            uInnerColor: { value: new THREE.Color(1.0, 0.85, 0.6) },
            uOuterColor: { value: new THREE.Color(0.8, 0.2, 0.05) },
            uInnerRadius: { value: 2.2 },
            uOuterRadius: { value: 14.0 }
        },
        vertexShader: `
            varying vec3 vWorldPos;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uSpin;
            uniform vec3 uCamPos;
            uniform vec3 uInnerColor;
            uniform vec3 uOuterColor;
            uniform float uInnerRadius;
            uniform float uOuterRadius;

            varying vec3 vWorldPos;

            // Pseudo-random hash
            float hash(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }

            // 2D Noise
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            // Fractional Brownian Motion for fluid plasma
            float fbm(vec2 p) {
                float value = 0.0;
                float amplitude = 0.5;
                for (int i = 0; i < 5; i++) {
                    value += amplitude * noise(p);
                    p *= 2.0;
                    amplitude *= 0.5;
                }
                return value;
            }

            void main() {
                float r = length(vWorldPos.xz);
                
                // Discard pixels outside the disk bounds
                if (r < uInnerRadius || r > uOuterRadius) discard;

                float normDist = (r - uInnerRadius) / (uOuterRadius - uInnerRadius);
                float angle = atan(vWorldPos.z, vWorldPos.x);
                
                // Differential rotation (Keplerian dynamics)
                float speed = 2.5 / sqrt(r);
                float currentAngle = angle - uTime * speed * (1.0 + uSpin * 0.5);

                // Map to polar coordinates for fluid flow
                vec2 polar = vec2(currentAngle * 3.0, r * 2.0);
                float plasma = fbm(polar - uTime * 0.3);
                plasma = smoothstep(0.1, 0.9, plasma); // Smooth out the noise

                // Relativistic Doppler Beaming (brighter approaching, dimmer receding)
                vec3 viewDir = normalize(uCamPos - vWorldPos);
                vec3 velocityDir = normalize(vec3(-vWorldPos.z, 0.0, vWorldPos.x));
                float dopplerDot = dot(viewDir, velocityDir);
                float doppler = 1.0 + dopplerDot * 0.8 * (1.0 - normDist);

                // Color mapping
                vec3 baseColor = mix(uInnerColor, uOuterColor, normDist);
                vec3 finalColor = baseColor * (0.4 + plasma * 1.5) * doppler;

                // Smooth radial fade (inner and outer edges)
                float alpha = smoothstep(0.0, 0.1, normDist) * smoothstep(1.0, 0.7, normDist);

                gl_FragColor = vec4(finalColor, alpha * 0.9);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    accretionDiskMesh = new THREE.Mesh(geometry, material);
    scene.add(accretionDiskMesh);
}

// --- 3. SMOOTH RELATIVISTIC JETS SHADER ---
function createJets() {
    if (jetMesh) {
        scene.remove(jetMesh);
        jetMesh.geometry.dispose();
        jetMesh.material.dispose();
    }

    // A cylinder representing the dual beams
    const geometry = new THREE.CylinderGeometry(0.5, 4.0, 50, 32, 1, true);
    
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 1.0 }
        },
        vertexShader: `
            varying vec3 vPos;
            void main() {
                vPos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uIntensity;
            varying vec3 vPos;

            // Simple noise for beam turbulence
            float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
                return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), f.x),
                           mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y);
            }

            void main() {
                // UV mapping for vertical flow
                vec2 uv = vec2(atan(vPos.z, vPos.x) * 2.0, abs(vPos.y) - uTime * 12.0);
                float turbulence = noise(uv * 2.0);
                
                // Fade edges vertically and horizontally
                float verticalFade = smoothstep(25.0, 2.0, abs(vPos.y));
                
                vec3 beamColor = vec3(0.4, 0.7, 1.0) * turbulence * uIntensity;
                gl_FragColor = vec4(beamColor, verticalFade * turbulence * 0.8);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    jetMesh = new THREE.Mesh(geometry, material);
    scene.add(jetMesh);
}

// --- 4. ANIMATION LOOP & RESIZE HANDLING ---
function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime() * state.simSpeed;
    
    // Update Accretion Disk Shader
    if (accretionDiskMesh) {
        accretionDiskMesh.material.uniforms.uTime.value = time;
        accretionDiskMesh.material.uniforms.uSpin.value = state.spin;
        accretionDiskMesh.material.uniforms.uCamPos.value.copy(camera.position);
        
        // Match colors to current UI filter state
        const filter = FILTER_MODES[state.activeFilter];
        if (filter) {
            accretionDiskMesh.material.uniforms.uInnerColor.value.setRGB(...filter.innerColor);
            accretionDiskMesh.material.uniforms.uOuterColor.value.setRGB(...filter.outerColor);
        }
    }

    // Update Jets Shader
    if (jetMesh) {
        jetMesh.material.uniforms.uTime.value = time;
        jetMesh.material.uniforms.uIntensity.value = state.accretionRate * 1.5;
        jetMesh.visible = state.jetsEnabled && state.accretionRate > 0.05;
    }

    // Keep the gravitational lensing shader updated
    if (blackHoleMesh) {
        blackHoleMesh.material.uniforms.uTime.value = time;
        blackHoleMesh.material.uniforms.uMass.value = state.mass;
    }

    controls.update();
    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- INITIALIZE SCENE ---
createBlackHole();
createAccretionDisk();
createJets();
animate();
