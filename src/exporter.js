// ================================================================
// exporter.js — Export scene as standalone playable HTML game
// Bundles the scene JSON + all engine source into one HTML file.
// GLB/asset files are referenced by path — user copies them manually.
// ================================================================
import * as S from './state.js';
import { exportScene as serializeScene } from './serializer.js';
import { CAM_TEMPLATES, activeCamSettings, DEFAULT_KEYBINDS } from './controllableSystem.js';

export function exportGame() {
  // Serialize current scene
  const sceneData = _captureSceneJSON();

  // Collect asset paths referenced by entities
  const assetPaths = _collectAssets();

  const html = _buildGameHTML(sceneData, assetPaths, activeCamSettings);

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'game.html';
  a.click();
  URL.revokeObjectURL(a.href);
}

function _captureSceneJSON() {
  return {
    version: '2.0',
    engine: 'EngineLeo',
    ts: new Date().toISOString(),
    camSettings: { ...activeCamSettings },
    entities: S.entities.map(e => ({
      id: e.id, name: e.name, type: e.type, layer: e.layer || 'default',
      visible: e.visible,
      transform: {
        position: e.mesh.position.toArray(),
        rotation: [e.mesh.rotation.x, e.mesh.rotation.y, e.mesh.rotation.z],
        scale:    e.mesh.scale.toArray(),
      },
      physics: e.physics ? {
        enabled: e.physics.enabled, type: e.physics.type, mass: e.physics.mass,
        gravity: e.physics.gravity, friction: e.physics.friction,
        restitution: e.physics.restitution, collider: e.physics.collider,
      } : null,
      controllable: e.controllable ? {
        type:     e.controllable.type,
        stats:    e.controllable.stats,
        keybinds: e.controllable.keybinds,
      } : null,
      glbSrc:      e._glbSrc || null,   // path to GLB file
      effects:     e._effects?.map(fx => ({ effect: fx.effect, offsetY: fx.offsetY })) || [],
      scripts:     e.scripts || [],
      scriptCodes: e.scriptCodes || {},
    })),
  };
}

function _collectAssets() {
  const paths = new Set();
  S.entities.forEach(e => { if (e._glbSrc) paths.add(e._glbSrc); });
  return [...paths];
}

function _buildGameHTML(scene, assets, camSettings) {
  const sceneJSON = JSON.stringify(scene);
  const assetList = assets.map(p => `  • ${p}`).join('\n') || '  (nenhum arquivo externo)';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${scene.entities.find(e=>e.name)?.name || 'EngineLeo Game'}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#080910;overflow:hidden;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}
#canvas{width:100%;height:100%;display:block}

/* Loading screen */
#loading{position:fixed;inset:0;background:#0d0e11;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;transition:opacity .5s}
#loading.hidden{opacity:0;pointer-events:none}
#loading h1{color:#5b8cff;font-family:monospace;font-size:28px;margin-bottom:16px}
#loading p{color:#7d8499;font-family:monospace;font-size:13px;margin-bottom:32px}
#loading-bar-wrap{width:280px;height:6px;background:#21252e;border-radius:3px;overflow:hidden}
#loading-bar{height:100%;background:#5b8cff;border-radius:3px;width:0%;transition:width .3s}
#loading-status{color:#4e5566;font-family:monospace;font-size:11px;margin-top:12px}
#loading-assets{color:#3d4455;font-family:monospace;font-size:10px;margin-top:8px;text-align:center;line-height:1.6;max-width:400px}

/* HUD */
#hud{position:fixed;inset:0;pointer-events:none}
#hud canvas{width:100%;height:100%;display:block}
</style>
</head>
<body>

<!-- Loading screen -->
<div id="loading">
  <h1>⬡ EngineLeo</h1>
  <p>Carregando cena...</p>
  <div id="loading-bar-wrap"><div id="loading-bar"></div></div>
  <div id="loading-status">Inicializando...</div>
  <div id="loading-assets"></div>
</div>

<!-- Viewport -->
<canvas id="canvas"></canvas>
<div id="hud"><canvas id="hud-canvas"></canvas></div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js",
    "three/examples/jsm/loaders/GLTFLoader.js": "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/GLTFLoader.js"
  },
  "scopes": {
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/": {
      "../../build/three.module.js": "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js"
    }
  }
}
</script>

<!-- ================================================================
  📁 ARQUIVOS EXTERNOS NECESSÁRIOS
  Copie os seguintes arquivos para a mesma pasta deste HTML:

${assetList}

  Estrutura recomendada:
  game.html
  assets/
    human_model.glb
    car_model.glb
    ... (outros GLBs usados na cena)

  Para usar GLBs de subpastas, mantenha o mesmo caminho relativo
  que foi configurado no editor.
================================================================ -->

<script type="module">
// ================================================================
// EngineLeo — Runtime standalone (gerado pelo editor)
// Exportado em: ${new Date().toLocaleString('pt-BR')}
// ================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SCENE_DATA = ${sceneJSON};
const CAM = SCENE_DATA.camSettings || {};

// ---- Renderer ----
const canvas  = document.getElementById('canvas');
const hudCvs  = document.getElementById('hud-canvas');
const hudCtx  = hudCvs.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x080910);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x080910, 0.015);

const gameCam = new THREE.PerspectiveCamera(CAM.camFOV || 65, 1, 0.1, 800);
let camYaw = 0, camPitch = 0;
let plocked = false;
document.addEventListener('pointerlockchange', () => { plocked = !!document.pointerLockElement; });
document.addEventListener('mousemove', e => {
  if (!plocked) return;
  camYaw   -= e.movementX * .002;
  camPitch = Math.max(-.7, Math.min(.6, camPitch - e.movementY * .002));
});
canvas.addEventListener('click', () => canvas.requestPointerLock());

// ---- Input ----
const keys = {};
let mouse = 0;
window.addEventListener('keydown',  e => { keys[e.code]=true;  e.preventDefault(); });
window.addEventListener('keyup',    e => { keys[e.code]=false; });
canvas.addEventListener('mousedown',e => { mouse |=  (1<<e.button); });
canvas.addEventListener('mouseup',  e => { mouse &= ~(1<<e.button); });

// ---- Scene helpers ----
scene.add(new THREE.AmbientLight(0x334466, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
sun.position.set(10,16,8); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
['left','right','top','bottom'].forEach((s,i)=>sun.shadow.camera[s]=[-30,30,30,-30][i]);
scene.add(sun);
scene.add(new THREE.GridHelper(60,60,0x1a1e2a,0x141820));

// ---- Resize ----
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  gameCam.aspect = window.innerWidth / window.innerHeight;
  gameCam.updateProjectionMatrix();
  hudCvs.width  = window.innerWidth;
  hudCvs.height = window.innerHeight;
}
window.addEventListener('resize', resize); resize();

// ---- Loading progress ----
let _loaded = 0, _total = 0;
const _setStatus = s => { document.getElementById('loading-status').textContent = s; };
const _setBar    = v => { document.getElementById('loading-bar').style.width = (v*100).toFixed(0)+'%'; };

// ---- Build scene from data ----
const entities = [];
const loader   = new GLTFLoader();
const _glbCache = {};

async function loadGLB(url) {
  if (_glbCache[url]) return _glbCache[url];
  return new Promise((res, rej) => loader.load(url, g => {
    _glbCache[url] = g; res(g);
  }, undefined, rej));
}

function mkMat(col) { return new THREE.MeshStandardMaterial({ color:col, roughness:.55, metalness:.1 }); }

async function buildScene() {
  const glbEntities = SCENE_DATA.entities.filter(e => e.glbSrc);
  _total = glbEntities.length;

  _setStatus('Carregando assets...');
  const assetInfoEl = document.getElementById('loading-assets');
  if (assetInfoEl && glbEntities.length) {
    assetInfoEl.textContent = glbEntities.map(e => e.glbSrc).join('\\n');
  }

  for (const d of SCENE_DATA.entities) {
    _setStatus('Criando: ' + d.name);
    const ent = await _buildEntity(d);
    if (ent) entities.push(ent);
    if (d.glbSrc) { _loaded++; _setBar(_loaded / Math.max(1, _total)); }
  }

  _setStatus('Pronto!');
  _setBar(1);
  await new Promise(r => setTimeout(r, 400));

  // Find first controllable
  const player = entities.find(e => e.type === 'humanoid') || entities.find(e => e.controllable);
  if (player) activeEnt = player;

  document.getElementById('loading').classList.add('hidden');
  setTimeout(() => { document.getElementById('loading').style.display='none'; }, 600);
}

async function _buildEntity(d) {
  let mesh;
  const pos = d.transform?.position || [0,0,0];
  const rot = d.transform?.rotation || [0,0,0];
  const scl = d.transform?.scale    || [1,1,1];

  if (d.type === 'plane') {
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mkMat(0x1a2416));
    mesh.rotation.x = -Math.PI/2;
  } else if (d.type === 'cube')     { mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mkMat(0x5b8cff)); }
  else if (d.type === 'sphere')     { mesh = new THREE.Mesh(new THREE.SphereGeometry(.5,32,16), mkMat(0x3ecf8e)); }
  else if (d.type === 'cylinder')   { mesh = new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,1,32), mkMat(0xffb347)); }
  else if (d.type === 'light-dir')  { const l=new THREE.DirectionalLight(0xfff4e0,.9); l.position.set(3,6,3); scene.add(l); return { id:d.id,name:d.name,type:d.type,mesh:l,controllable:d.controllable }; }
  else if (d.type === 'light-point'){ const l=new THREE.PointLight(0xffffff,1.2,12); scene.add(l); return { id:d.id,name:d.name,type:d.type,mesh:l,controllable:d.controllable }; }
  else { mesh = new THREE.Group(); }

  // Load GLB if referenced
  if (d.glbSrc) {
    try {
      const gltf = await loadGLB(d.glbSrc);
      const model = gltf.scene.clone();
      model.traverse(c => { if (c.isMesh) { c.castShadow=true; c.receiveShadow=true; } });
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y;
      if (h > 0.01) model.scale.setScalar(1.8 / h);
      const grp = new THREE.Group(); grp.add(model); mesh = grp;
    } catch(e) { console.warn('GLB load failed:', d.glbSrc, e); }
  }

  mesh.position.fromArray(pos);
  mesh.rotation.set(...rot);
  mesh.scale.fromArray(scl);
  if (mesh.isMesh) { mesh.castShadow=true; mesh.receiveShadow=true; }
  scene.add(mesh);

  return { id:d.id, name:d.name, type:d.type, mesh, controllable:d.controllable, physics:d.physics };
}

// ---- Simple character controller ----
let activeEnt   = null;
const GRAV      = -9.81;
let charVel     = new THREE.Vector3();
let charGrounded = false;

function updatePlayer(dt) {
  if (!activeEnt?.mesh) return;
  const m  = activeEnt.mesh;
  const ch = activeEnt.controllable;
  if (!ch) return;
  const st = ch.stats;
  const kb = ch.keybinds;
  const type = ch.type;

  if (type === 'humanoid') {
    _updateHumanoid(dt, m, st, kb);
  } else {
    _updateVehicle(dt, m, st, kb, type);
  }
  _updateCamera(dt, m, st);
}

function isDown(bind) {
  if (!bind) return false;
  if (bind.key==='Mouse0') return !!(mouse&1);
  if (bind.key==='Mouse2') return !!(mouse&4);
  return !!keys[bind.key];
}

function _updateHumanoid(dt, m, st, kb) {
  const fwd = new THREE.Vector3(-Math.sin(camYaw),0,-Math.cos(camYaw));
  const rgt = new THREE.Vector3( Math.cos(camYaw),0,-Math.sin(camYaw));
  const mv  = new THREE.Vector3();
  if (isDown(kb.forward))  mv.addScaledVector(fwd, 1);
  if (isDown(kb.backward)) mv.addScaledVector(fwd,-1);
  if (isDown(kb.left))     mv.addScaledVector(rgt,-1);
  if (isDown(kb.right))    mv.addScaledVector(rgt, 1);
  const moving = mv.length()>.01;
  if (moving) mv.normalize();

  const speed = isDown(kb.sprint) ? (st.sprint||10) : (st.speed||5);
  if (charGrounded) {
    charVel.x += (mv.x*speed - charVel.x) * Math.min(1,(st.accel||15)*dt);
    charVel.z += (mv.z*speed - charVel.z) * Math.min(1,(st.accel||15)*dt);
  } else {
    charVel.x *= Math.max(0, 1 - 2*dt);
    charVel.z *= Math.max(0, 1 - 2*dt);
  }
  charVel.y += GRAV*dt;
  m.position.addScaledVector(charVel, dt);
  const box = new THREE.Box3().setFromObject(m);
  if (box.min.y <= 0) { m.position.y -= box.min.y; if(charVel.y<0)charVel.y=0; charGrounded=true; }
  else charGrounded=false;
  if (isDown(kb.jump) && charGrounded) { charVel.y=st.jump||6; charGrounded=false; }
  if (moving && charGrounded) {
    const ta=Math.atan2(mv.x,mv.z); let df=ta-m.rotation.y;
    while(df>Math.PI)df-=Math.PI*2; while(df<-Math.PI)df+=Math.PI*2;
    m.rotation.y += df*Math.min(1,(st.rotSpd||8)*dt);
  }
}

let _vSpeed=0, _vSteer=0;
function _updateVehicle(dt, m, st, kb, type) {
  const sign = st.forwardSign ?? 1;
  const throttle = isDown(kb.forward)?1:0;
  const reverse  = isDown(kb.backward)?1:0;
  const target   = throttle*(st.topSpeed||20)*sign - reverse*(st.reverseSpeed||4)*sign;
  _vSpeed += (target-_vSpeed)*Math.min(1,(st.accel||3)*dt);
  _vSpeed *= (1-(st.drag||0.5)*dt);
  if(Math.abs(_vSpeed)<0.02)_vSpeed=0;

  const si = ((isDown(kb.right)?1:0)-(isDown(kb.left)?1:0)) * sign;
  _vSteer += (si*(st.steerMax||0.6)-_vSteer)*Math.min(1,(st.steerReturn||6)*dt);
  if(Math.abs(_vSpeed)>0.1) m.rotation.y -= _vSteer*(Math.abs(_vSpeed)/(st.topSpeed||20))*(st.turnRate||2.2)*dt;

  const heading = new THREE.Vector3(-Math.sin(m.rotation.y)*sign,0,-Math.cos(m.rotation.y)*sign);
  const vel = heading.clone().multiplyScalar(_vSpeed);
  vel.y += GRAV*dt;
  m.position.addScaledVector(vel,dt);
  if(m.position.y<0){m.position.y=0;vel.y=0;}
}

function _updateCamera(dt, m, st) {
  const dist  = st.camD || CAM.camD || 5.5;
  const baseY = st.camY || CAM.camY || 1.8;
  const pitch = camPitch + (CAM.camPitchBase || -0.18);
  const clamped = Math.max(-1.4, Math.min(0.6, pitch));
  const co = new THREE.Vector3(
    Math.sin(camYaw)*Math.cos(clamped)*dist,
    baseY - Math.sin(clamped)*dist*0.4,
    Math.cos(camYaw)*Math.cos(clamped)*dist,
  );
  gameCam.position.lerp(m.position.clone().add(co), Math.min(1,(CAM.camLerp||0.10)*60*dt));
  gameCam.lookAt(m.position.clone().add(new THREE.Vector3(0,baseY*.6,0)));
}

// ---- HUD ----
function drawHUD() {
  const w=hudCvs.width, h=hudCvs.height;
  hudCtx.clearRect(0,0,w,h);
  // Crosshair
  hudCtx.strokeStyle='rgba(255,255,255,.6)'; hudCtx.lineWidth=1.5;
  hudCtx.beginPath();
  hudCtx.moveTo(w/2-8,h/2); hudCtx.lineTo(w/2+8,h/2);
  hudCtx.moveTo(w/2,h/2-8); hudCtx.lineTo(w/2,h/2+8);
  hudCtx.stroke();
  // Controls hint (bottom)
  if (!plocked) {
    hudCtx.fillStyle='rgba(0,0,0,.5)'; hudCtx.roundRect(w/2-150,h-36,300,24,4); hudCtx.fill();
    hudCtx.fillStyle='rgba(200,210,220,.7)'; hudCtx.font='11px monospace'; hudCtx.textAlign='center';
    hudCtx.fillText('Clique para ativar controles · WASD mover · Shift correr · Space pular',w/2,h-19);
    hudCtx.textAlign='left';
  }
}

// ---- Main loop ----
let last = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now=performance.now(), dt=Math.min((now-last)/1000,.05); last=now;
  updatePlayer(dt);
  drawHUD();
  renderer.render(scene, gameCam);
}

// ---- Boot ----
buildScene().then(() => loop());
</script>
</body>
</html>`;
}
