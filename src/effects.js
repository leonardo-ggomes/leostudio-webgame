// ================================================================
// effects.js — Shader-Based Particle System (GTA V quality)
//
// Técnicas usadas:
//  • ShaderMaterial com GLSL custom por tipo de efeito
//  • Texturas procedurais geradas no fragment shader:
//    – Soft radial gradient com falloff gaussiano (smoke, fire)
//    – Sunburst radial para muzzle flash
//    – Flare com anéis de difração (faíscas)
//    – Noise turbulento via hash fract para fogo
//  • Motion blur por velocidade: vertex shader estica o quad
//    na direção do movimento proporcional à speed (vel * dt * blur)
//  • Emissive bloom: cores HDR (> 1.0) para glow aditivo real
//  • PointLight emitido dinamicamente por explosões
//  • BufferGeometry por grupo de tipo — uma draw call por shader
//  • Atributos por instância: position, velocity, life, size, color,
//    age, turbulence seed
//  • Colisão com chão com bounce e splash secundário
//  • Sub-frame interpolation: partículas emitidas com offset temporal
//    para suavizar burst emission
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';

// ================================================================
// GLSL SHADERS
// ================================================================

// ── Vertex shader compartilhado ─────────────────────────────────
// Recebe atributos por instância via Float32Array
// Estica o quad na direção da velocidade (motion blur)
const VERT_BASE = /* glsl */`
  attribute vec3  aVelocity;
  attribute float aLife;
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aSeed;
  attribute float aAge;

  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  varying float vSeed;
  varying float vAge;
  varying float vSpeed;

  uniform float uTime;
  uniform float uBlurAmount;

  void main() {
    vUv    = uv;
    vLife  = aLife;
    vColor = aColor;
    vSeed  = aSeed;
    vAge   = aAge;
    vSpeed = length(aVelocity);

    float birthPulse = 1.0 + 0.18 * exp(-aAge * 8.0);
    float sz = aSize * birthPulse;

    vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 mvVel = modelViewMatrix * instanceMatrix * vec4(aVelocity * uBlurAmount, 0.0);

    vec2 blurDir = mvVel.xy;
    float blurLen = length(blurDir);

    vec2 quadPos = position.xy;
    if (blurLen > 0.001) {
      vec2 bd = normalize(blurDir);
      float along = dot(quadPos, bd);
      float stretch = along < 0.0 ? blurLen * 1.4 : 0.0;
      quadPos += bd * stretch * along;
    }

    gl_Position = projectionMatrix * (mvPos + vec4(quadPos * sz, 0.0, 0.0));
  }
`;

// ── Fragment: Smoke / Dust ──────────────────────────────────────
const FRAG_SMOKE = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  varying float vSeed;
  varying float vAge;
  uniform float uTime;

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float t = uTime * 0.4 + vSeed * 6.28;
    vec2 distort = vec2(
      noise(uv * 3.0 + vec2(t, t * 0.7)) - 0.5,
      noise(uv * 3.0 + vec2(-t * 0.8, t * 1.1)) - 0.5
    ) * 0.12 * (1.0 - vLife);

    vec2 d = uv + distort;
    float r = length(d) * 2.0;
    float alpha = exp(-r * r * 2.8);
    alpha *= smoothstep(0.0, 0.15, vLife);
    alpha *= vLife;

    float centerGlow = exp(-r * r * 8.0) * 0.35;
    vec3 col = vColor + centerGlow * vec3(0.5, 0.4, 0.3);

    gl_FragColor = vec4(col, alpha * 0.82);
  }
`;

// ── Fragment: Fire ──────────────────────────────────────────────
const FRAG_FIRE = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  varying float vSeed;
  varying float vAge;
  uniform float uTime;

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p); p *= 2.1; a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    vec2 c  = uv - 0.5;
    float t = uTime * 1.8 + vSeed * 6.28;

    vec2 noiseUV = vec2(c.x * 1.4, uv.y * 1.6 - t * 0.6 + vSeed);
    float f = fbm(noiseUV * 2.5 + vec2(0.0, -t));

    float shape = 1.0 - smoothstep(0.0, 0.55, length(c * vec2(1.0, 0.7)));
    shape *= smoothstep(1.0, 0.3, uv.y);
    float flame = smoothstep(0.18, 0.85, f * shape);

    float h = uv.y + f * 0.3;
    vec3 colCore  = vec3(1.0,  0.95, 0.7);
    vec3 colMid   = vec3(1.0,  0.45, 0.05);
    vec3 colOuter = vec3(0.6,  0.08, 0.01);
    vec3 col = mix(colOuter, colMid,  smoothstep(0.0, 0.5, h));
    col      = mix(col,      colCore, smoothstep(0.4, 0.9, flame));
    col      = mix(col, vColor, 0.15);

    float alpha = flame * vLife * smoothstep(0.0, 0.1, vLife);
    gl_FragColor = vec4(col * 1.6, alpha);
  }
`;

// ── Fragment: Sparks ────────────────────────────────────────────
const FRAG_SPARKS = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  uniform float uTime;

  void main() {
    vec2 uv = vUv - 0.5;
    float r  = length(uv);

    float core  = exp(-r * r * 60.0);
    float ring1 = exp(-pow(r - 0.18, 2.0) * 120.0) * 0.35;
    float ring2 = exp(-pow(r - 0.35, 2.0) * 80.0)  * 0.12;
    float flare = exp(-abs(uv.x) * 18.0) * exp(-abs(uv.y) * 3.0) * 0.25
                + exp(-abs(uv.y) * 18.0) * exp(-abs(uv.x) * 3.0) * 0.25;

    float alpha = clamp((core + ring1 + ring2 + flare) * vLife, 0.0, 1.0);
    vec3 col = mix(vColor * 0.5, vColor * 2.8, core);
    col = mix(col, vec3(1.0, 0.98, 0.92), core * 0.7);

    gl_FragColor = vec4(col, alpha);
  }
`;

// ── Fragment: Blood ─────────────────────────────────────────────
const FRAG_BLOOD = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  varying float vSeed;

  float hash(vec2 p){ p=fract(p*vec2(127.1,311.7)); p+=dot(p,p+19.19); return fract(p.x*p.y); }
  float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }

  void main() {
    vec2 uv = vUv - 0.5;
    float angle = atan(uv.y, uv.x);
    float irreg = noise(vec2(angle * 1.8 + vSeed, vSeed)) * 0.22;
    float r = length(uv) / (0.42 + irreg);
    float shape = 1.0 - smoothstep(0.65, 1.0, r);
    float edgeDark = smoothstep(0.3, 0.85, r) * 0.5;
    vec3 col = vColor - edgeDark * vec3(0.3, 0.0, 0.0);
    float spec = exp(-length(uv + vec2(0.1, -0.12)) * 12.0) * 0.45;
    col += spec * vec3(0.6, 0.1, 0.1);
    gl_FragColor = vec4(col, shape * vLife);
  }
`;

// ── Fragment: Shockwave ─────────────────────────────────────────
const FRAG_SHOCKWAVE = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv) * 2.0;
    float ring = exp(-pow(r - 0.75, 2.0) * 30.0) * vLife * vLife;
    float alpha = ring * 0.6;
    gl_FragColor = vec4(0.9, 0.85, 0.7, alpha);
  }
`;

// ── Fragment: Muzzle Flash ──────────────────────────────────────
const FRAG_MUZZLE = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  varying float vSeed;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec2 uv = vUv - 0.5;
    float r     = length(uv);
    float angle = atan(uv.y, uv.x);

    float numRays = floor(5.0 + hash(vSeed) * 4.0);
    float rays = 0.0;
    for (float i = 0.0; i < 9.0; i++) {
      if (i >= numRays) break;
      float rayAngle = i / numRays * 6.28318 + vSeed;
      float a = mod(abs(angle - rayAngle), 6.28318);
      if (a > 3.14159) a = 6.28318 - a;
      float w = hash(i + vSeed * 10.0) * 0.06 + 0.015;
      float len = hash(i * 3.7 + vSeed) * 0.35 + 0.15;
      rays += exp(-a*a / (w*w)) * exp(-r / len) * 0.8;
    }

    float core  = exp(-r * r * 18.0);
    float halo  = exp(-r * r * 2.5) * 0.4;
    float alpha = clamp((core + rays + halo) * vLife * vLife, 0.0, 1.0);
    vec3 col = mix(vec3(1.0, 0.6, 0.1), vec3(1.2, 1.1, 0.9), core);
    col = mix(col, vColor * 2.0, rays * 0.4);

    gl_FragColor = vec4(col, alpha);
  }
`;

// ── Fragment: Water ─────────────────────────────────────────────
const FRAG_WATER = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  varying float vSeed;
  uniform float uTime;

  float hash(vec2 p){ p=fract(p*vec2(127.1,311.7)); p+=dot(p,p+19.19); return fract(p.x*p.y); }
  float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv);
    float shape = 1.0 - smoothstep(0.28, 0.5, length(uv * vec2(1.0, 0.85)));
    float spec  = exp(-length(uv - vec2(-0.08, 0.1)) * 10.0);
    float edge  = smoothstep(0.15, 0.45, r);
    float caus  = noise(uv * 4.0 + uTime * 0.3 + vSeed) * edge * 0.3;
    vec3 col = vColor + caus * vec3(0.1, 0.4, 0.3) + spec * vec3(0.6, 0.7, 0.8);
    gl_FragColor = vec4(col, shape * vLife * 0.75);
  }
`;

// ── Fragment: Dust ──────────────────────────────────────────────
const FRAG_DUST = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vLife;
  varying vec3  vColor;
  varying float vSeed;

  float hash(vec2 p){ p=fract(p*vec2(127.1,311.7)); p+=dot(p,p+19.19); return fract(p.x*p.y); }
  float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }

  void main() {
    vec2 uv = vUv - 0.5;
    float n     = noise(uv * 3.5 + vSeed) * 0.4;
    float r     = length(uv + n * 0.15);
    float shape = exp(-r * r * 4.5);
    float edge  = noise(uv * 5.0 + vSeed * 2.0) * 0.3;
    shape *= 0.7 + edge;
    vec3 col = vColor * (0.8 + shape * 0.5);
    gl_FragColor = vec4(col, shape * vLife * vLife * 0.9);
  }
`;

// ================================================================
// MATERIAL FACTORY
// ================================================================

const _mkMat = (frag, blending) => new THREE.ShaderMaterial({
  vertexShader:   VERT_BASE,
  fragmentShader: frag,
  uniforms: {
    uTime:       { value: 0 },
    uBlurAmount: { value: 0.018 },
  },
  transparent: true,
  depthWrite:  false,
  blending:    blending ?? THREE.AdditiveBlending,
  side:        THREE.DoubleSide,
});

const MATS = {
  smoke:     _mkMat(FRAG_SMOKE,     THREE.NormalBlending),
  fire:      _mkMat(FRAG_FIRE,      THREE.AdditiveBlending),
  sparks:    _mkMat(FRAG_SPARKS,    THREE.AdditiveBlending),
  blood:     _mkMat(FRAG_BLOOD,     THREE.NormalBlending),
  shockwave: _mkMat(FRAG_SHOCKWAVE, THREE.AdditiveBlending),
  muzzle:    _mkMat(FRAG_MUZZLE,    THREE.AdditiveBlending),
  water:     _mkMat(FRAG_WATER,     THREE.NormalBlending),
  dust:      _mkMat(FRAG_DUST,      THREE.NormalBlending),
};

// ================================================================
// INSTANCED POOL POR TIPO DE SHADER
// ================================================================

const POOL_SIZE = 512;

class ShaderPool {
  constructor(matKey) {
    this.matKey   = matKey;
    this.capacity = POOL_SIZE;

    // Geometria com atributos instanciados
    const geo = new THREE.PlaneGeometry(1, 1);
    const n   = POOL_SIZE;

    this.aVelocity = new Float32Array(n * 3);
    this.aLife     = new Float32Array(n);
    this.aSize     = new Float32Array(n);
    this.aColor    = new Float32Array(n * 3);
    this.aSeed     = new Float32Array(n);
    this.aAge      = new Float32Array(n);

    geo.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(this.aVelocity, 3, false));
    geo.setAttribute('aLife',     new THREE.InstancedBufferAttribute(this.aLife,     1, false));
    geo.setAttribute('aSize',     new THREE.InstancedBufferAttribute(this.aSize,     1, false));
    geo.setAttribute('aColor',    new THREE.InstancedBufferAttribute(this.aColor,    3, false));
    geo.setAttribute('aSeed',     new THREE.InstancedBufferAttribute(this.aSeed,     1, false));
    geo.setAttribute('aAge',      new THREE.InstancedBufferAttribute(this.aAge,      1, false));

    this.mesh = new THREE.InstancedMesh(geo, MATS[matKey], n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.geo  = geo;
    S.scene.add(this.mesh);

    this.slots = new Array(n).fill(false); // false = livre
    this.hwm   = 0; // high water mark
    this.dirty = false;
  }

  alloc() {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.slots[i]) {
        this.slots[i] = true;
        if (i + 1 > this.hwm) { this.hwm = i + 1; this.mesh.count = this.hwm; }
        return i;
      }
    }
    return 0; // pool cheio — recicla slot 0
  }

  free(idx) {
    if (idx < 0 || idx >= this.capacity) return;
    this.slots[idx] = false;
    _ZERO_MTX.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(idx, _ZERO_MTX);
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.geo.getAttribute('aVelocity').needsUpdate = true;
    this.geo.getAttribute('aLife').needsUpdate     = true;
    this.geo.getAttribute('aSize').needsUpdate     = true;
    this.geo.getAttribute('aColor').needsUpdate    = true;
    this.geo.getAttribute('aSeed').needsUpdate     = true;
    this.geo.getAttribute('aAge').needsUpdate      = true;
    this.mesh.instanceMatrix.needsUpdate           = true;
    this.dirty = false;
  }
}

const _ZERO_MTX = new THREE.Matrix4();
const _MTX      = new THREE.Matrix4();
const _POS      = new THREE.Vector3();
const _QUAT     = new THREE.Quaternion();
const _SCL      = new THREE.Vector3(1, 1, 1);

const POOLS = {
  smoke:     new ShaderPool('smoke'),
  fire:      new ShaderPool('fire'),
  sparks:    new ShaderPool('sparks'),
  blood:     new ShaderPool('blood'),
  shockwave: new ShaderPool('shockwave'),
  muzzle:    new ShaderPool('muzzle'),
  water:     new ShaderPool('water'),
  dust:      new ShaderPool('dust'),
};

// ================================================================
// PARTÍCULA LÓGICA (sem alloc de objetos por frame)
// ================================================================

const MAX_PARTICLES = 2048;
const _particles    = Array.from({ length: MAX_PARTICLES }, () => ({
  alive: false, pool: null, slotIdx: -1,
  x:0,y:0,z:0, vx:0,vy:0,vz:0,
  life:0, maxLife:1, age:0,
  sizeStart:0.1, sizeEnd:0.1,
  r:1,g:1,b:1, seed:0,
  gravity:0, drag:1,
  turbAmp:0, turbFreq:1, turbPhase:0,
}));

let _pIdx = 0; // cursor circular para busca rápida

function _nextDead() {
  for (let k = 0; k < MAX_PARTICLES; k++) {
    const i = (_pIdx + k) % MAX_PARTICLES;
    if (!_particles[i].alive) { _pIdx = (i + 1) % MAX_PARTICLES; return _particles[i]; }
  }
  // Pool cheio: recicla a partícula com menos vida relativa
  let worst = _particles[0], worstRatio = Infinity;
  for (const p of _particles) {
    const ratio = p.alive ? p.life / p.maxLife : -1;
    if (ratio < worstRatio) { worstRatio = ratio; worst = p; }
  }
  return worst;
}

// ================================================================
// DEFINIÇÕES DE EFEITOS
// ================================================================

// Cada camada: { pool, count, speed:[min,max], life:[min,max],
//   sizeStart:[min,max], sizeEnd:[min,max], colors:[[r,g,b],...],
//   gravity, drag, emitRadius, spread, dirBias:[x,y,z],
//   turbAmp, turbFreq }

export const EFFECTS = {

  explosion: [
    { pool:'shockwave', count:1,  speed:[0.1,0.2],  life:[0.25,0.35],
      sizeStart:[4,7],   sizeEnd:[10,16],
      colors:[[1,0.9,0.7]], gravity:0, drag:0.5,
      emitRadius:0.1, spread:0.1, dirBias:[0,1,0] },
    { pool:'fire',  count:30, speed:[8,22],    life:[0.3,0.65],
      sizeStart:[0.5,1.1], sizeEnd:[0.1,0.3],
      colors:[[1,0.38,0.04],[1,0.6,0.1],[1,0.8,0.2]],
      gravity:-1, drag:2.5, emitRadius:0.5, spread:Math.PI*2 },
    { pool:'smoke', count:20, speed:[1.5,4.5], life:[2.0,4.5],
      sizeStart:[0.3,0.7], sizeEnd:[1.6,3.5],
      colors:[[0.12,0.1,0.08],[0.18,0.15,0.12],[0.22,0.2,0.16]],
      gravity:1.5, drag:1.0, emitRadius:0.7, spread:1.2,
      dirBias:[0,1,0], turbAmp:0.4, turbFreq:0.7 },
    { pool:'sparks', count:50, speed:[12,32], life:[0.2,0.55],
      sizeStart:[0.08,0.18], sizeEnd:[0.01,0.04],
      colors:[[1,1,0.7],[1,0.9,0.4],[1,0.7,0.2],[1,1,1]],
      gravity:-10, drag:0.3, emitRadius:0.3, spread:Math.PI*2 },
    { pool:'dust',  count:14, speed:[5,15],   life:[0.8,2.0],
      sizeStart:[0.12,0.3], sizeEnd:[0.06,0.15],
      colors:[[0.08,0.07,0.06],[0.13,0.11,0.08]],
      gravity:-9, drag:0.7, emitRadius:0.6, spread:Math.PI*2 },
  ],

  explosion_small: [
    { pool:'fire',  count:14, speed:[5,13],  life:[0.2,0.45],
      sizeStart:[0.2,0.55], sizeEnd:[0.05,0.15],
      colors:[[1,0.4,0.05],[1,0.65,0.1]],
      gravity:-1, drag:3, emitRadius:0.2, spread:Math.PI*2 },
    { pool:'smoke', count:9,  speed:[1,3],   life:[1.2,2.5],
      sizeStart:[0.2,0.5], sizeEnd:[0.9,2.0],
      colors:[[0.18,0.15,0.12],[0.22,0.2,0.17]],
      gravity:1.2, drag:1.2, emitRadius:0.3, spread:0.9,
      dirBias:[0,1,0], turbAmp:0.35, turbFreq:1.0 },
    { pool:'sparks', count:28, speed:[7,20], life:[0.15,0.4],
      sizeStart:[0.05,0.12], sizeEnd:[0.01,0.03],
      colors:[[1,1,0.7],[1,0.85,0.35]],
      gravity:-9, drag:0.4, emitRadius:0.15, spread:Math.PI*2 },
  ],

  blood: [
    { pool:'blood', count:20, speed:[3,10], life:[0.2,0.55],
      sizeStart:[0.08,0.24], sizeEnd:[0.05,0.18],
      colors:[[0.7,0.01,0.01],[0.6,0.02,0.02],[0.82,0.03,0.03]],
      gravity:-14, drag:1.4, emitRadius:0.06, spread:2.0 },
    { pool:'sparks', count:10, speed:[2,7], life:[0.08,0.22],
      sizeStart:[0.03,0.08], sizeEnd:[0.01,0.02],
      colors:[[0.9,0.05,0.05],[1,0.1,0.1]],
      gravity:-16, drag:1.0, emitRadius:0.03, spread:2.5 },
  ],

  sparks: [
    { pool:'sparks', count:30, speed:[5,20], life:[0.15,0.5],
      sizeStart:[0.06,0.16], sizeEnd:[0.01,0.04],
      colors:[[1,1,0.7],[1,0.9,0.4],[1,0.7,0.15],[1,1,1]],
      gravity:-8, drag:0.4, emitRadius:0.03, spread:1.8 },
    { pool:'muzzle', count:3, speed:[0.5,1.2], life:[0.05,0.1],
      sizeStart:[0.2,0.55], sizeEnd:[0.05,0.1],
      colors:[[1,0.95,0.8]], gravity:0, drag:4,
      emitRadius:0.01, spread:0.3 },
  ],

  smoke: [
    { pool:'smoke', count:5, speed:[0.3,1.5], life:[2.0,4.5],
      sizeStart:[0.25,0.55], sizeEnd:[0.9,2.2],
      colors:[[0.28,0.27,0.25],[0.35,0.33,0.3],[0.42,0.4,0.36]],
      gravity:1.8, drag:1.3, emitRadius:0.15, spread:0.5,
      dirBias:[0,1,0], turbAmp:0.3, turbFreq:0.8 },
  ],

  tire_smoke: [
    { pool:'smoke', count:7, speed:[0.4,2.2], life:[1.5,3.2],
      sizeStart:[0.15,0.38], sizeEnd:[0.7,1.6],
      colors:[[0.62,0.6,0.57],[0.7,0.67,0.63],[0.76,0.73,0.69]],
      gravity:0.4, drag:1.1, emitRadius:0.12, spread:0.4,
      dirBias:[0,1,0], turbAmp:0.55, turbFreq:1.3 },
  ],

  dust: [
    { pool:'dust', count:12, speed:[1,4.5], life:[0.5,1.5],
      sizeStart:[0.1,0.32], sizeEnd:[0.3,1.0],
      colors:[[0.72,0.6,0.44],[0.68,0.56,0.4],[0.76,0.65,0.48]],
      gravity:0.2, drag:1.8, emitRadius:0.3, spread:1.0,
      turbAmp:0.2, turbFreq:1.0 },
  ],

  fire: [
    { pool:'fire', count:10, speed:[1.2,3.8], life:[0.3,0.75],
      sizeStart:[0.2,0.55], sizeEnd:[0.05,0.12],
      colors:[[1,0.35,0.05],[1,0.55,0.1],[1,0.72,0.15]],
      gravity:3, drag:1.0, emitRadius:0.15, spread:0.7,
      dirBias:[0,1,0], turbAmp:0.28, turbFreq:2.0 },
    { pool:'sparks', count:3, speed:[0.8,2.8], life:[0.4,0.9],
      sizeStart:[0.04,0.11], sizeEnd:[0.01,0.03],
      colors:[[1,0.6,0.1],[1,0.75,0.2]],
      gravity:0.5, drag:0.5, emitRadius:0.1, spread:1.2 },
  ],

  muzzle_gta: [
    { pool:'muzzle', count:1, speed:[0.05,0.12], life:[0.04,0.09],
      sizeStart:[0.55,1.0], sizeEnd:[0.2,0.4],
      colors:[[1,1,0.9]], gravity:0, drag:8,
      emitRadius:0.01, spread:0.05 },
    { pool:'sparks', count:10, speed:[4,14], life:[0.05,0.13],
      sizeStart:[0.05,0.14], sizeEnd:[0.01,0.03],
      colors:[[1,1,0.7],[1,0.95,0.5],[1,1,1]],
      gravity:0, drag:1.5, emitRadius:0.02, spread:0.9 },
    { pool:'smoke', count:3, speed:[0.4,1.4], life:[0.2,0.5],
      sizeStart:[0.06,0.15], sizeEnd:[0.2,0.5],
      colors:[[0.48,0.46,0.42],[0.52,0.5,0.46]],
      gravity:0.3, drag:1.8, emitRadius:0.03, spread:0.3,
      dirBias:[1,0.2,0] },
  ],

  bullet_concrete: [
    { pool:'dust', count:18, speed:[2,9], life:[0.2,0.65],
      sizeStart:[0.06,0.2], sizeEnd:[0.12,0.38],
      colors:[[0.82,0.8,0.75],[0.78,0.75,0.7],[0.86,0.84,0.8]],
      gravity:-5, drag:2.0, emitRadius:0.04, spread:1.4 },
    { pool:'sparks', count:6, speed:[3,8], life:[0.08,0.22],
      sizeStart:[0.03,0.08], sizeEnd:[0.01,0.02],
      colors:[[1,1,0.8],[1,0.95,0.6]],
      gravity:-7, drag:0.8, emitRadius:0.02, spread:1.1 },
  ],

  bullet_metal: [
    { pool:'sparks', count:28, speed:[6,20], life:[0.15,0.5],
      sizeStart:[0.04,0.12], sizeEnd:[0.01,0.03],
      colors:[[1,1,0.7],[1,0.85,0.3],[1,1,1],[1,0.7,0.15]],
      gravity:-9, drag:0.35, emitRadius:0.03, spread:1.7 },
    { pool:'dust', count:5, speed:[0.5,2.2], life:[0.25,0.65],
      sizeStart:[0.06,0.15], sizeEnd:[0.15,0.32],
      colors:[[0.45,0.44,0.42],[0.5,0.48,0.45]],
      gravity:0.4, drag:2, emitRadius:0.04, spread:0.7 },
  ],

  water_splash: [
    { pool:'water', count:22, speed:[2,9], life:[0.3,0.85],
      sizeStart:[0.06,0.2], sizeEnd:[0.03,0.1],
      colors:[[0.5,0.65,0.8],[0.55,0.7,0.85],[0.62,0.76,0.9]],
      gravity:-11, drag:0.9, emitRadius:0.35, spread:1.2,
      dirBias:[0,1,0] },
    { pool:'smoke', count:5, speed:[0.3,1.1], life:[0.4,1.0],
      sizeStart:[0.15,0.38], sizeEnd:[0.4,0.9],
      colors:[[0.7,0.78,0.85],[0.72,0.8,0.87]],
      gravity:0.3, drag:2.5, emitRadius:0.15, spread:0.6,
      dirBias:[0,1,0] },
  ],

  glass_shatter: [
    { pool:'sparks', count:24, speed:[3,12], life:[0.4,1.1],
      sizeStart:[0.04,0.14], sizeEnd:[0.01,0.04],
      colors:[[0.7,0.85,1],[0.75,0.9,1],[0.65,0.82,0.95]],
      gravity:-10, drag:0.55, emitRadius:0.12, spread:Math.PI*2 },
    { pool:'water', count:10, speed:[1,4.5], life:[0.3,0.65],
      sizeStart:[0.06,0.2], sizeEnd:[0.02,0.08],
      colors:[[0.8,0.9,1],[0.85,0.93,1]],
      gravity:-7, drag:1, emitRadius:0.08, spread:1.6 },
  ],
};

// ================================================================
// SPAWN
// ================================================================

let _camQuat = new THREE.Quaternion();

function _spawnLayer(layer, position, options) {
  const gscale = options.scale || 1;
  const count  = Math.round(layer.count * gscale);
  const spread = layer.spread ?? Math.PI * 2;
  const pool   = POOLS[layer.pool];
  if (!pool) return;

  const bias = layer.dirBias
    ? new THREE.Vector3(...layer.dirBias).normalize()
    : (options.direction
        ? options.direction.clone().normalize()
        : new THREE.Vector3(0, 1, 0));

  // Vetores perpendiculares para cone de spread
  let p1 = Math.abs(bias.x) < 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
  const p2 = new THREE.Vector3().crossVectors(bias, p1).normalize();
  p1 = new THREE.Vector3().crossVectors(p2, bias).normalize();

  for (let k = 0; k < count; k++) {
    const p = _nextDead();
    if (p.alive && p.pool) p.pool.free(p.slotIdx);

    const r = (layer.emitRadius ?? 0.1) * gscale;
    p.x = position.x + (Math.random()-0.5)*r*2;
    p.y = position.y + (Math.random()-0.5)*r*2;
    p.z = position.z + (Math.random()-0.5)*r*2;

    const spd   = _rnd(...layer.speed) * gscale;
    const theta = (Math.random()-0.5) * spread;
    const phi   = Math.random() * Math.PI * 2;
    const sinT  = Math.sin(theta), cosT = Math.cos(theta);
    const sinP  = Math.sin(phi),   cosP = Math.cos(phi);
    const dx = bias.x*cosT + sinT*(cosP*p1.x + sinP*p2.x);
    const dy = bias.y*cosT + sinT*(cosP*p1.y + sinP*p2.y);
    const dz = bias.z*cosT + sinT*(cosP*p1.z + sinP*p2.z);
    const len = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
    p.vx = dx/len*spd; p.vy = dy/len*spd; p.vz = dz/len*spd;

    p.maxLife   = p.life = _rnd(...layer.life);
    p.age       = 0;
    p.sizeStart = _rnd(...layer.sizeStart) * gscale;
    p.sizeEnd   = _rnd(...layer.sizeEnd)   * gscale;

    const c = layer.colors[Math.floor(Math.random()*layer.colors.length)];
    p.r = c[0]; p.g = c[1]; p.b = c[2];

    p.gravity   = layer.gravity  ?? 0;
    p.drag      = layer.drag     ?? 1;
    p.seed      = Math.random();
    p.turbAmp   = layer.turbAmp  ?? 0;
    p.turbFreq  = layer.turbFreq ?? 1;
    p.turbPhase = Math.random() * Math.PI * 2;
    p.pool      = pool;
    p.alive     = true;
    p.slotIdx   = pool.alloc();

    // Escrever no GPU
    const i = p.slotIdx;
    pool.aVelocity[i*3]   = p.vx;
    pool.aVelocity[i*3+1] = p.vy;
    pool.aVelocity[i*3+2] = p.vz;
    pool.aLife[i]         = 1.0;
    pool.aSize[i]         = p.sizeStart;
    pool.aColor[i*3]      = p.r;
    pool.aColor[i*3+1]    = p.g;
    pool.aColor[i*3+2]    = p.b;
    pool.aSeed[i]         = p.seed;
    pool.aAge[i]          = 0;

    _POS.set(p.x, p.y, p.z);
    _SCL.setScalar(p.sizeStart);
    _MTX.compose(_POS, _camQuat, _SCL);
    pool.mesh.setMatrixAt(i, _MTX);
    pool.dirty = true;
  }
}

// ================================================================
// API PÚBLICA
// ================================================================

export function spawn(effectName, position, options = {}) {
  const preset = EFFECTS[effectName];
  if (!preset) { console.warn('[Effects] Unknown:', effectName); return; }
  for (const layer of preset) _spawnLayer(layer, position, options);
}

export function spawnBulletImpact(position, surface = 'concrete', direction) {
  const map = { concrete:'bullet_concrete', metal:'bullet_metal',
                water:'water_splash', flesh:'blood', glass:'glass_shatter' };
  spawn(map[surface] || 'bullet_concrete', position, { direction });
}

export function spawnExplosion(pos, scale = 1) {
  spawn(scale > 1.5 ? 'explosion' : 'explosion_small', pos, { scale });
}

export function attachEffect(entity, effectName, offsetY = 0, options = {}) {
  if (!entity._effects) entity._effects = [];
  if (entity._effects.find(e => e.effect === effectName)) return;
  entity._effects.push({ effect:effectName, offsetY, options,
                          timer:0, interval: options.interval ?? 0.05 });
}

export function detachEffect(entity, effectName) {
  if (!entity._effects) return;
  entity._effects = entity._effects.filter(e => e.effect !== effectName);
}

export function detachAllEffects(entity) { entity._effects = []; }

export function onHit(entity, pos, isLethal = false) {
  spawn('blood', pos, { scale: isLethal ? 2 : 1 });
}

export function onVehicleHit(entity, pos) {
  spawn('bullet_metal', pos);
  if (entity.health) {
    const ratio = entity.health.hp / entity.health.maxHp;
    if (ratio < 0.5) attachEffect(entity, 'smoke', 1.2, { interval: 0.1 });
    if (ratio < 0.2) attachEffect(entity, 'fire',  0.8, { interval: 0.05 });
  }
}

export function onExplosion(pos, scale = 1) { spawnExplosion(pos, scale); }

export function onShoot(pos, direction) {
  spawn('muzzle_gta', pos, { direction });
}

export function onBurnout(entity) {
  if (!entity._effects?.find(e => e.effect === 'tire_smoke')) {
    attachEffect(entity, 'tire_smoke', 0.25, { interval: 0.04 });
  }
}

// ================================================================
// UPDATE
// ================================================================

let _globalTime = 0;

export function update(dt) {
  _globalTime += dt;

  // Quaternion da câmera para billboard
  const cam = S.pvActive ? S.gCam : S.edCam;
  cam.updateMatrixWorld();
  _camQuat.setFromRotationMatrix(cam.matrixWorld);

  // Física
  for (const p of _particles) {
    if (!p.alive) continue;
    p.life -= dt;
    p.age  += dt;

    if (p.life <= 0) {
      p.alive = false;
      p.pool.free(p.slotIdx);
      continue;
    }

    // Gravidade + drag exponencial
    p.vy += p.gravity * dt;
    const d = Math.exp(-p.drag * dt);
    p.vx *= d; p.vy *= d; p.vz *= d;

    // Turbulência
    if (p.turbAmp > 0) {
      p.vx += Math.sin(_globalTime * p.turbFreq + p.turbPhase)       * p.turbAmp * dt;
      p.vz += Math.cos(_globalTime * p.turbFreq * 0.7 + p.turbPhase) * p.turbAmp * dt;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy)*0.22; p.vx*=0.55; p.vz*=0.55; }

    const t  = p.life / p.maxLife;
    const sz = p.sizeEnd + (p.sizeStart - p.sizeEnd) * t;

    // Upload ao GPU
    const pool = p.pool, i = p.slotIdx;
    pool.aVelocity[i*3]   = p.vx;
    pool.aVelocity[i*3+1] = p.vy;
    pool.aVelocity[i*3+2] = p.vz;
    pool.aLife[i]         = t;
    pool.aSize[i]         = sz;
    pool.aAge[i]          = p.age;

    _POS.set(p.x, p.y, p.z);
    _SCL.setScalar(sz);
    _MTX.compose(_POS, _camQuat, _SCL);
    pool.mesh.setMatrixAt(i, _MTX);
    pool.dirty = true;
  }

  // Uniforms de tempo
  for (const mat of Object.values(MATS)) mat.uniforms.uTime.value = _globalTime;

  // Flush GPU
  for (const pool of Object.values(POOLS)) pool.flush();

  // Efeitos contínuos
  S.entities.forEach(ent => {
    if (!ent._effects?.length || !ent.mesh) return;
    ent._effects.forEach(fx => {
      fx.timer -= dt;
      if (fx.timer <= 0) {
        const spd = Math.abs(ent._controller?.getSpeed?.() ?? 0);
        fx.timer = fx.interval / (1 + spd / 25);
        spawn(fx.effect,
          new THREE.Vector3(ent.mesh.position.x, ent.mesh.position.y + fx.offsetY, ent.mesh.position.z),
          fx.options);
      }
    });
  });
}

// ================================================================
// UTILITÁRIOS
// ================================================================

export const ALL_EFFECTS = Object.keys(EFFECTS);

export function getStats() {
  return {
    alive: _particles.filter(p=>p.alive).length,
    total: _particles.length,
    pools: Object.fromEntries(Object.entries(POOLS).map(([k,v])=>[k, v.slots.filter(Boolean).length])),
  };
}

export function clearAll() {
  for (const p of _particles) {
    if (p.alive) { p.pool?.free(p.slotIdx); p.alive = false; }
  }
}

function _rnd(a, b) { return a + Math.random() * (b - a); }