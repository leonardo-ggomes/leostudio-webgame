// ================================================================
// main.js — Entry point: wires all modules together
// ================================================================
import * as THREE from 'three';
import * as S          from './state.js';
import * as Ents       from './entities.js';
import * as Physics    from './physics.js';
import * as Char       from './character.js';
import * as Gizmos     from './gizmos.js';
import * as Inspector  from './inspector.js';
import * as Serializer from './serializer.js';
import * as ScriptEd   from './scriptEditor.js';
import { showModal, showToast, makeOrbit, makeResizer, onResize } from './ui.js';
import * as Ctrl       from './controllableSystem.js';
import * as AnimPanel  from './animationPanel.js';
import { nextKey }     from './inputManager.js';
import { _loadHumanoidGLB } from './entities.js';

// ----------------------------------------------------------------
// SCENE SETUP
// ----------------------------------------------------------------
const VP    = document.getElementById('vp');
const pvCvs = document.getElementById('pv-canvas');

S.scene.add(new THREE.GridHelper(60, 60, 0x1a1e2a, 0x141820));
// Bug 7 fix: single canonical mouse-look handler (character.js duplicate removed)
document.addEventListener('mousemove', e => {
  if (!S.pvActive || !document.pointerLockElement) return;
  S.setCamYaw(S.camYaw - e.movementX * .002);
  S.setCamPitch(Math.max(-.7, Math.min(.6, S.camPitch - e.movementY * .002)));
});
S.scene.add(new THREE.AxesHelper(0.6));
S.scene.add(new THREE.AmbientLight(0x334466, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
sun.position.set(10, 16, 8); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
['left','right','top','bottom'].forEach((s,i)=>sun.shadow.camera[s]=[-30,30,30,-30][i]);
sun.shadow.camera.far = 100;
S.scene.add(sun);

// ----------------------------------------------------------------
// ORBIT + RESIZE
// ----------------------------------------------------------------
const orb = makeOrbit(S.edCam);
makeResizer('res-l', 'panel-left', null);
makeResizer('res-r', null, 'panel-right');

function resize() { onResize(S.renderer, S.edCam, S.gCam, pvCvs); }
window.addEventListener('resize', resize);
window.addEventListener('engineresize', resize);
resize();

// ----------------------------------------------------------------
// SELECTION
// ----------------------------------------------------------------
const RAY = new THREE.Raycaster(), MV = new THREE.Vector2();
const outMat = new THREE.MeshBasicMaterial({ color:0x5b8cff, side:THREE.BackSide, transparent:true, opacity:.28 });
let outMesh = null;

function selectEnt(ent) {
  S.setSelEnt(ent);
  // Bug 10 fix: safely remove previous outline from any parent
  if (outMesh) {
    if (outMesh.parent) outMesh.parent.remove(outMesh);
    else S.scene.remove(outMesh);
    outMesh = null;
  }
  // Only add outline to direct Mesh (not Group/humanoid pivot)
  if (ent?.mesh?.isMesh) {
    outMesh = new THREE.Mesh(ent.mesh.geometry, outMat);
    outMesh.scale.setScalar(1.06);
    ent.mesh.add(outMesh);
  }
  Inspector.refresh();
  Inspector.refreshHier();
  AnimPanel.refresh();
  updStatus();
}
window._selectEnt = selectEnt; // used by inspector.js item click handlers

VP.addEventListener('click', e => {
  if (e.button!==0 || Gizmos.isDragging() || S.pvActive) return;
  const r = VP.getBoundingClientRect();
  MV.x=((e.clientX-r.left)/r.width)*2-1; MV.y=-((e.clientY-r.top)/r.height)*2+1;
  RAY.setFromCamera(MV, S.edCam);
  const meshes = S.entities.filter(e=>e.mesh?.isMesh).map(e=>e.mesh);
  const hits = RAY.intersectObjects(meshes, true);
  if (hits.length) {
    const obj = hits[0].object;
    const found = S.entities.find(e => e.mesh===obj || (e.mesh.isGroup && e.mesh.children.some(c=>c===obj||c.children?.includes(obj))));
    if (found) selectEnt(found);
  } else selectEnt(null);
});

// ----------------------------------------------------------------
// GIZMO EVENTS
// ----------------------------------------------------------------
Gizmos.build();
VP.addEventListener('mousedown',   e => { if (Gizmos.onMouseDown(e, S.selEnt, orb)) e.stopPropagation(); });
window.addEventListener('mousemove', e => { Gizmos.onMouseMove(e, S.selEnt); if (Gizmos.isDragging()) Inspector.refreshXf(); });
window.addEventListener('mouseup',   () => Gizmos.onMouseUp(orb));

// ----------------------------------------------------------------
// PLAY / STOP
// ----------------------------------------------------------------
export function togglePlay() {
  S.setPlaying(!S.playing); S.setPaused(false);
  const btn = document.getElementById('btn-play');
  if (S.playing) {
    S.setPlaySnap(Physics.snapshotScene());
    Physics.resetVelocities();
    S.entities.forEach(ent => {
      ScriptEd.startAll(ent);
      // Bug 8 fix: reset currentState + lock so setState always fires
      if (ent.animMgr) {
        ent.animMgr.currentState = null;
        ent.animMgr._locked = false;
        ent.animMgr.setState('idle');
      }
    });
    btn.textContent='■ Stop'; btn.classList.replace('play','stop-mode');
    document.getElementById('play-badge').classList.add('on');
  } else {
    Physics.restoreSnapshot(S.playSnap);
    // Stop all animations on Stop
    S.entities.forEach(ent => { if (ent.animMgr) ent.animMgr.stopAll(); });
    btn.textContent='▶ Play'; btn.classList.replace('stop-mode','play');
    document.getElementById('play-badge').classList.remove('on');
    Inspector.refreshXf();
  }
  updStatus();
}

// ----------------------------------------------------------------
// PREVIEW — possess selected (or first controllable) entity
// ----------------------------------------------------------------
export function togglePreview() {
  if (!S.pvActive) {
    const ent = S.selEnt?.controllable ? S.selEnt
      : S.entities.find(e => e.controllable);
    if (!ent) { showModal('Preview','Adicione um Humanoid ou Veículo na cena.',[{label:'OK',cls:''}]); return; }
    Ctrl.possess(ent);
    S.setPvChar(ent); // Bug 6 fix: set pvChar so HUD can read controller state
    S.setActiveCam(S.gCam); S.setPvActive(true);
    document.getElementById('pv-badge').classList.add('on');
    document.getElementById('play-badge').classList.remove('on');
    document.getElementById('pv-canvas').classList.add('on');
    document.getElementById('btn-pv').classList.add('active');
    Gizmos.gGrp.visible = false;
    // Remove foco de qualquer botão para evitar que Space o acione
    if (document.activeElement) document.activeElement.blur();
    document.getElementById('vp').requestPointerLock();
  } else {
    _exitPreview();
  }
  updStatus();
}
function _exitPreview() {
  Ctrl.possess(null);
  S.setPvChar(null);
  S.setPvActive(false); S.setActiveCam(S.edCam);
  document.getElementById('pv-badge').classList.remove('on');
  document.getElementById('pv-canvas').classList.remove('on');
  document.getElementById('btn-pv').classList.remove('active');
  if (document.pointerLockElement) document.exitPointerLock();
}

export function possessSelected() {
  const ent = S.selEnt;
  if (!ent?.controllable) return;
  if (!S.pvActive) togglePreview();
  else Ctrl.possess(ent);
}

export function changeCtrlType(type) {
  const ent = S.selEnt;
  if (!ent) return;
  ent.controllable = Ctrl.makeControllable(type);
  Inspector.refreshControllable();
  _showCtrlStats(type);
}

export function loadCustomGLB() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.glb,.gltf';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const ent = S.selEnt; if (!ent) return;
    showToast('Carregando ' + file.name + '...');
    await _loadHumanoidGLB(ent, url);
    Inspector.refresh();
    AnimPanel.refresh();
  };
  input.click();
}

function _showCtrlStats(type) {
  const h = document.getElementById('ct-stats-humanoid');
  const v = document.getElementById('ct-stats-vehicle');
  if (h) h.style.display = type === 'humanoid' ? '' : 'none';
  if (v) v.style.display = type === 'vehicle'  ? '' : 'none';
}

// ----------------------------------------------------------------
// ADD OBJECT
// ----------------------------------------------------------------
export function addObj(type) {
  document.getElementById('add-menu').classList.remove('open');
  const ent = Ents.createEnt(type);
  ent.mesh.position.set((Math.random()-.5)*4, type==='plane'?0:1, (Math.random()-.5)*4);
  selectEnt(ent);
  if (ent.char) Inspector.switchTab('ctrl'); _showCtrlStats(ent.controllable?.type || 'humanoid');
  updStatus();
}

export function toggleAddMenu(e) {
  const menu=document.getElementById('add-menu'), btn=document.getElementById('btn-add');
  const r=btn.getBoundingClientRect();
  menu.style.top=r.bottom+4+'px'; menu.style.left=r.left+'px';
  menu.classList.toggle('open');
  if (e) e.stopPropagation();
}
document.addEventListener('click', e => {
  if (!e.target.closest('#add-menu')&&!e.target.closest('#btn-add'))
    document.getElementById('add-menu').classList.remove('open');
});

// ----------------------------------------------------------------
// TOOLBAR ACTIONS
// ----------------------------------------------------------------
export function setGMode(m) {
  S.setGizmoMode(m);
  ['move','rot','scl'].forEach(k => document.getElementById('btn-'+k).classList.remove('active'));
  document.getElementById({translate:'btn-move',rotate:'btn-rot',scale:'btn-scl'}[m]).classList.add('active');
}
export function toggleSpace() {
  S.setGizmoSpace(S.gizmoSpace==='world'?'local':'world');
  document.getElementById('btn-space').textContent = S.gizmoSpace==='world'?'Global':'Local';
}
export function toggleSnap(t) {
  S.snap[t]=!S.snap[t];
  document.getElementById('snap-'+t).classList.toggle('on', S.snap[t]);
}

// ----------------------------------------------------------------
// INSPECTOR ACTIONS (delegated from HTML onclick)
// ----------------------------------------------------------------
export function deleteSel() {
  if (!S.selEnt) return;
  if (outMesh) { outMesh.parent?.remove(outMesh); outMesh=null; }
  Ents.removeEnt(S.selEnt);
  S.setSelEnt(null); Gizmos.gGrp.visible=false;
  Inspector.refresh(); Inspector.refreshHier(); updStatus();
}
export function dupSel() {
  if (!S.selEnt) return;
  const e=Ents.createEnt(S.selEnt.type, S.selEnt.name+'_copy');
  e.mesh.position.copy(S.selEnt.mesh.position).addScalar(.6);
  e.mesh.rotation.copy(S.selEnt.mesh.rotation);
  e.mesh.scale.copy(S.selEnt.mesh.scale);
  selectEnt(e);
}
export function focusSel() { if (S.selEnt) { orb.tgt.copy(S.selEnt.mesh.position); orb.update(); } }
export function resetXf()  { Inspector.resetXf(); Gizmos.update(S.selEnt); }
export function applyImpulse() {
  const iy=+document.getElementById('imp-y').value||5;
  Physics.applyImpulse(S.selEnt, iy);
}
export function togVis(e, id) {
  e.stopPropagation();
  const ent=S.entities.find(e=>e.id===id); if (!ent) return;
  ent.visible=!ent.visible; ent.mesh.visible=ent.visible; Inspector.refreshHier();
}

// ----------------------------------------------------------------
// SCRIPTS
// ----------------------------------------------------------------
export function addScript() {
  if (!S.selEnt) return;
  const n=ScriptEd.add(S.selEnt); Inspector.refreshSc(); ScriptEd.open(S.selEnt,n);
}
export function openSCEditor(n) { ScriptEd.open(S.selEnt,n); }
export function rmScript(n)     { ScriptEd.remove(S.selEnt,n); Inspector.refreshSc(); }
export function applyScript()   { ScriptEd.apply(S.selEnt); Inspector.refreshSc(); }
export function closeSCEditor() { ScriptEd.close(); }

// ----------------------------------------------------------------
// KEYBINDS
// ----------------------------------------------------------------
export function startListen(action) {
  if (!S.selEnt?.controllable) return;
  const el = document.getElementById('kbi-' + action);
  if (!el) return;
  el.classList.add('listening'); el.value = '...';
  nextKey().then(({ code, label }) => {
    S.selEnt.controllable.keybinds[action].key   = code;
    S.selEnt.controllable.keybinds[action].label = label;
    el.value = label; el.classList.remove('listening');
  });
}
export function resetKB() {
  if (!S.selEnt?.controllable) return;
  S.selEnt.controllable.keybinds = JSON.parse(JSON.stringify(Ctrl.DEFAULT_KEYBINDS));
  Inspector.refreshControllable();
}

// ----------------------------------------------------------------
// SERIALIZER
// ----------------------------------------------------------------
export function exportScene()     { Serializer.exportScene(); }
export function importScene(ev)   { Serializer.importScene(ev.target.files[0], () => { Inspector.refresh(); Inspector.refreshHier(); updStatus(); }); ev.target.value=''; }
export function importGLTF(ev)    { Serializer.importGLTF(ev.target.files[0], ent => { selectEnt(ent); Inspector.refreshHier(); updStatus(); }); ev.target.value=''; }

// ----------------------------------------------------------------
// KEYBOARD SHORTCUTS
// ----------------------------------------------------------------
document.addEventListener('keydown', e => {
  if (Inspector.onKeyForRebind(e)) return; // intercept keybind reassignment

  // Em preview mode: bloqueia TUDO do editor e previne comportamentos padrão
  // (Space ativa botão focado, arrows fazem scroll, etc.)
  if (S.pvActive) {
    e.preventDefault();
    if (e.key === 'Escape') togglePreview();
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (document.getElementById('sc-overlay').classList.contains('open')) return;

  // Previne Space/arrows de acionar botões focados ou rolar a página
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
  }

  switch(e.key) {
    case 'w': case 'W': setGMode('translate'); break;
    case 'e': case 'E': setGMode('rotate');    break;
    case 'r': case 'R': setGMode('scale');     break;
    case 'Delete': deleteSel(); break;
    case 'f': case 'F': focusSel(); break;
    case 'p': case 'P': togglePlay(); break;
    case 'Escape': document.getElementById('add-menu').classList.remove('open'); break;
  }
  if (e.ctrlKey && e.key === 'd') { e.preventDefault(); dupSel(); }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); exportScene(); }
});

// ----------------------------------------------------------------
// STATUS
// ----------------------------------------------------------------
function updStatus() {
  document.getElementById('status-txt').textContent =
    `${S.entities.length} obj${S.selEnt?' — '+S.selEnt.name:''}${S.playing?' | ▶':''}${S.pvActive?' | ◎':''}`;
}

// ----------------------------------------------------------------
// RENDER LOOP
// ----------------------------------------------------------------
Ents.buildDefaultScene();
Inspector.refreshHier();
Inspector.refresh();
updStatus();

let last=performance.now(), frames=0, fpsT=0;
function loop() {
  requestAnimationFrame(loop);
  const now=performance.now(), dt=Math.min((now-last)/1000,.05); last=now;
  frames++; fpsT+=dt;
  if (fpsT>=.5) {
    document.getElementById('info-fps').textContent='FPS: '+Math.round(frames/fpsT);
    document.getElementById('info-tri').textContent='Tri: '+S.renderer.info.render.triangles.toLocaleString();
    document.getElementById('info-obj').textContent='Obj: '+S.entities.length;
    frames=0; fpsT=0; updStatus();
  }

  Physics.step(dt);

  // Tick ALL entity animators every frame (mixer needs continuous update)
  S.entities.forEach(e => { if (e.animMgr) e.animMgr.update(dt); });

  if (S.pvActive) { Ctrl.update(dt); Char.drawHUD(); }

  if (S.playing && !S.paused) S.entities.forEach(e => ScriptEd.tickAll(e, dt));

  Gizmos.update(S.selEnt);
  Gizmos.drawNav();
  S.renderer.render(S.scene, S.activeCam);
}
loop();

console.log('%cEngineLeo', 'color:#5b8cff;font-weight:bold;font-size:14px');
console.log('W/E/R Gizmos · F Focar · Del Deletar · Ctrl+D Duplicar · Ctrl+S Export · P Play');
