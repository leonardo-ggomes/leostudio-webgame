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
import * as Collision from './collision.js';
import * as Combat    from './combat.js';
import * as Effects   from './effects.js';
import { exportGame } from './exporter.js';

// ----------------------------------------------------------------
// SCENE SETUP
// ----------------------------------------------------------------
const VP    = document.getElementById('vp');
const pvCvs = document.getElementById('pv-canvas');

S.scene.add(new THREE.GridHelper(60, 60, 0x1a1e2a, 0x141820));

// ----------------------------------------------------------------
// MOUSE LOOK — handler canônico
//
// Dois modos separados dentro do pointer lock:
//   • Hip fire (RMB solto): mouse orbita a câmera livremente.
//     O personagem NÃO gira — só a câmera se move.
//   • ADS (RMB pressionado): mouse orbita a câmera E sinaliza
//     para o HumanoidController girar o corpo junto.
//     A câmera trava no ombro direito (calculado em controllableSystem).
//
// Não há nenhum outro listener de mousemove no projeto — este é
// o único ponto que toca S.camYaw e S.camPitch.
// ----------------------------------------------------------------
let _rmbDown = false;

document.addEventListener('mousedown', e => {
  if (e.button === 2 && (S.pvActive || S.playing)) _rmbDown = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 2) _rmbDown = false;
});

document.addEventListener('mousemove', e => {
  // Só processa quando pointer lock está ativo (modo preview/play)
  if (!document.pointerLockElement) return;
  if (!S.pvActive && !S.playing)    return;

  const dx = e.movementX * 0.002;
  const dy = e.movementY * 0.002;

  // Yaw e pitch da câmera atualizam sempre (hip fire E ADS)
  S.setCamYaw(S.camYaw - dx);
  S.setCamPitch(Math.max(-1.2, Math.min(0.6, S.camPitch - dy)));

  // Sinaliza para o controller se o RMB está pressionado.
  // O HumanoidController lê S.aimActive para saber se deve
  // girar o corpo junto com a câmera.
  S.setMouseAim(_rmbDown);
});

// Libera o flag de mira quando o pointer lock é liberado
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) {
    _rmbDown = false;
    S.setMouseAim(false);
  }
});

S.scene.add(new THREE.AxesHelper(0.6));
S.scene.add(new THREE.AmbientLight(0x334466, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
sun.position.set(10, 16, 8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
['left','right','top','bottom'].forEach((s,i) => sun.shadow.camera[s] = [-30,30,30,-30][i]);
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
  if (outMesh) {
    if (outMesh.parent) outMesh.parent.remove(outMesh);
    else S.scene.remove(outMesh);
    outMesh = null;
  }
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
window._selectEnt = selectEnt;

VP.addEventListener('click', e => {
  if (e.button !== 0 || Gizmos.isDragging() || S.pvActive) return;
  const r = VP.getBoundingClientRect();
  MV.x = ((e.clientX - r.left) / r.width)  *  2 - 1;
  MV.y = -((e.clientY - r.top) / r.height) *  2 + 1;
  RAY.setFromCamera(MV, S.edCam);
  const meshes = S.entities.filter(e => e.mesh?.isMesh).map(e => e.mesh);
  const hits   = RAY.intersectObjects(meshes, true);
  if (hits.length) {
    const obj   = hits[0].object;
    const found = S.entities.find(e =>
      e.mesh === obj ||
      (e.mesh.isGroup && e.mesh.children.some(c => c === obj || c.children?.includes(obj)))
    );
    if (found) selectEnt(found);
  } else selectEnt(null);
});

// ----------------------------------------------------------------
// GIZMO EVENTS
// ----------------------------------------------------------------
Gizmos.build();
VP.addEventListener('mousedown',    e => { if (Gizmos.onMouseDown(e, S.selEnt, orb)) e.stopPropagation(); });
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
      if (ent.animMgr) {
        ent.animMgr.currentState = null;
        ent.animMgr._locked = false;
        ent.animMgr.setState('idle');
      }
    });
    btn.textContent = '■ Stop'; btn.classList.replace('play', 'stop-mode');
    document.getElementById('play-badge').classList.add('on');
  } else {
    Physics.restoreSnapshot(S.playSnap);
    S.entities.forEach(ent => { if (ent.animMgr) ent.animMgr.stopAll(); });
    btn.textContent = '▶ Play'; btn.classList.replace('stop-mode', 'play');
    document.getElementById('play-badge').classList.remove('on');
    Inspector.refreshXf();
  }
  updStatus();
}

// ----------------------------------------------------------------
// PREVIEW
// ----------------------------------------------------------------
export async function togglePreview(targetEnt) {
  if (!S.pvActive) {
    const ent = targetEnt
      || (S.selEnt?.controllable ? S.selEnt : null)
      || S.entities.find(e => e.controllable);
    if (!ent) {
      showModal('Preview', 'Adicione um Humanoid ou Veículo na cena.', [{ label:'OK', cls:'' }]);
      return;
    }

    await _runPreviewLoader(ent);

    Ctrl.possess(ent);
    S.setPvChar(ent);
    S.setActiveCam(S.gCam);
    S.setPvActive(true);

    // Garante que mouseAim começa desativado — jogador não entra mirando
    S.setMouseAim(false);
    _rmbDown = false;

    document.getElementById('pv-badge').classList.add('on');
    document.getElementById('play-badge').classList.remove('on');
    document.getElementById('pv-canvas').classList.add('on');
    document.getElementById('btn-pv').classList.add('active');
    Gizmos.gGrp.visible = false;
    if (document.activeElement) document.activeElement.blur();

    // Pointer lock — necessário para capturar movementX/Y do mouse
    document.getElementById('vp').requestPointerLock();
  } else {
    _exitPreview();
  }
  updStatus();
}

async function _runPreviewLoader(ent) {
  const overlay  = document.getElementById('pv-loading');
  const msgEl    = document.getElementById('pv-load-msg');
  const barEl    = document.getElementById('pv-load-bar');
  const detailEl = document.getElementById('pv-load-detail');
  if (!overlay) return;

  overlay.style.display = 'flex';
  const setBar = v => { if (barEl) barEl.style.width = (v * 100).toFixed(0) + '%'; };
  const setMsg = (m, d = '') => {
    if (msgEl)    msgEl.textContent    = m;
    if (detailEl) detailEl.textContent = d;
  };

  const toLoad = S.entities.filter(e => e.type === 'humanoid' && !e.animMgr);
  const total  = Math.max(1, toLoad.length + S.entities.length);
  let   done   = 0;

  setMsg('Verificando objetos...', S.entities.length + ' entidades na cena');
  setBar(0.05);
  await new Promise(r => setTimeout(r, 80));

  for (const e of S.entities) {
    done++;
    setBar(0.1 + (done / total) * 0.7);
    setMsg('Preparando: ' + e.name, e.type);
    await new Promise(r => setTimeout(r, 16));
  }

  const unloaded = S.entities.filter(e => e.type === 'humanoid' && !e.animMgr);
  if (unloaded.length) {
    setMsg('Aguardando modelos 3D...', unloaded.map(e => e.name).join(', '));
    setBar(0.85);
    let waited = 0;
    while (unloaded.some(e => !e.animMgr) && waited < 4000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
  }

  setMsg('Pronto!', ent.name + ' pronto para controlar');
  setBar(1);
  await new Promise(r => setTimeout(r, 350));
  overlay.style.display = 'none';
}

function _exitPreview() {
  Ctrl.possess(null);
  S.setPvChar(null);
  S.setPvActive(false);
  S.setActiveCam(S.edCam);
  S.setMouseAim(false);
  _rmbDown = false;
  document.getElementById('pv-badge').classList.remove('on');
  document.getElementById('pv-canvas').classList.remove('on');
  document.getElementById('btn-pv').classList.remove('active');
  if (document.pointerLockElement) document.exitPointerLock();
}

export function possessSelected() {
  const ent = S.selEnt;
  if (!ent?.controllable) { showToast('Selecione uma entidade com Controller primeiro.'); return; }
  if (S.pvActive) {
    Ctrl.possess(ent);
    S.setPvChar(ent);
  } else {
    togglePreview(ent);
  }
}

export function changeCtrlType(type) {
  const ent = S.selEnt;
  if (!ent) return;
  ent.controllable = Ctrl.makeControllable(type);
  Inspector.refreshControllable();
  _showCtrlStats(type);
}

export function loadCustomGLB() {
  const ent = S.selEnt;
  if (!ent?.controllable) { showToast('Selecione um Humanoid, Veículo ou Aeronave primeiro.'); return; }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.glb,.gltf';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const url  = URL.createObjectURL(file);
    showToast('Carregando ' + file.name + '...');
    ent._glbSrc = url.startsWith('blob:') ? (ent._glbSrc || 'assets/model.glb') : url;
    await Ents.loadControllableGLB(ent, url);
    Inspector.refresh();
    AnimPanel.refresh();
    showToast('✓ Modelo carregado: ' + file.name);
  };
  input.click();
}

function _showCtrlStats(type) {
  ['humanoid','vehicle','helicopter','aircraft','motorcycle','horse','bicycle'].forEach(t => {
    const el = document.getElementById('ct-stats-' + t);
    if (el) el.style.display = type === t ? '' : 'none';
  });
}
window._showCtrlStats = _showCtrlStats;

// ----------------------------------------------------------------
// ADD OBJECT
// ----------------------------------------------------------------
export function addObj(type) {
  document.getElementById('add-menu').classList.remove('open');
  const ent = Ents.createEnt(type);
  ent.mesh.position.set((Math.random() - .5) * 4, type === 'plane' ? 0 : 1, (Math.random() - .5) * 4);
  selectEnt(ent);
  if (ent.controllable) { Inspector.switchTab('ctrl'); _showCtrlStats(ent.controllable.type); }
  updStatus();
}

export function toggleAddMenu(e) {
  const menu = document.getElementById('add-menu'), btn = document.getElementById('btn-add');
  const r = btn.getBoundingClientRect();
  menu.style.top  = r.bottom + 4 + 'px';
  menu.style.left = r.left + 'px';
  menu.classList.toggle('open');
  if (e) e.stopPropagation();
}
document.addEventListener('click', e => {
  if (!e.target.closest('#add-menu') && !e.target.closest('#btn-add'))
    document.getElementById('add-menu').classList.remove('open');
});

// ----------------------------------------------------------------
// TOOLBAR
// ----------------------------------------------------------------
export function setGMode(m) {
  S.setGizmoMode(m);
  ['move','rot','scl'].forEach(k => document.getElementById('btn-' + k).classList.remove('active'));
  document.getElementById({ translate:'btn-move', rotate:'btn-rot', scale:'btn-scl' }[m]).classList.add('active');
}
export function toggleSpace() {
  S.setGizmoSpace(S.gizmoSpace === 'world' ? 'local' : 'world');
  document.getElementById('btn-space').textContent = S.gizmoSpace === 'world' ? 'Global' : 'Local';
}
export function toggleSnap(t) {
  S.snap[t] = !S.snap[t];
  const btn = document.getElementById('snap-' + t + '-tb');
  if (btn) btn.classList.toggle('snap-on', S.snap[t]);
}

// ----------------------------------------------------------------
// CAMERA PANEL
// ----------------------------------------------------------------
export function applyCamTemplate(name) { Ctrl.applyTemplate(name); _refreshCamPanel(); }

export function applyCamParam() {
  const d = parseFloat(document.getElementById('cam-dist')?.value)   || 5;
  const h = parseFloat(document.getElementById('cam-height')?.value) || 2;
  const p = parseFloat(document.getElementById('cam-pitch')?.value)  || -0.2;
  const l = parseFloat(document.getElementById('cam-lerp')?.value)   || 0.10;
  const f = parseFloat(document.getElementById('cam-fov')?.value)    || 65;
  Ctrl.setCamSettings({ camD: d, camY: h, camPitchBase: p, camLerp: l, camFOV: f });
  const sel = document.getElementById('cam-template');
  if (sel) sel.value = 'Custom';
}

export function applyVehDirection(val) {
  const ent = S.selEnt;
  if (!ent?.controllable?.stats) { showToast('Selecione um Veículo ou Moto.'); return; }
  ent.controllable.stats.forwardSign = parseFloat(val);
  _refreshVehDirUI(ent);
}
export function applyVehSteering(val) {
  const ent = S.selEnt;
  if (!ent?.controllable?.stats) { showToast('Selecione um Veículo ou Moto.'); return; }
  ent.controllable.stats.steerSign = parseFloat(val);
  _refreshVehDirUI(ent);
}
function _refreshVehDirUI(ent) {
  const st = ent?.controllable?.stats; if (!st) return;
  document.getElementById('veh-fwd-normal')?.classList.toggle('active',  (st.forwardSign ?? 1) ===  1);
  document.getElementById('veh-fwd-invert')?.classList.toggle('active',  (st.forwardSign ?? 1) === -1);
  document.getElementById('veh-steer-normal')?.classList.toggle('active', (st.steerSign   ?? 1) ===  1);
  document.getElementById('veh-steer-invert')?.classList.toggle('active', (st.steerSign   ?? 1) === -1);
}
export function refreshVehDirPanel() { _refreshVehDirUI(S.selEnt); }

function _refreshCamPanel() {
  const cs = Ctrl.activeCamSettings;
  const $  = id => document.getElementById(id);
  if ($('cam-dist'))   $('cam-dist').value   = cs.camD         ?? 5;
  if ($('cam-height')) $('cam-height').value  = cs.camY         ?? 2;
  if ($('cam-pitch'))  $('cam-pitch').value   = cs.camPitchBase ?? -0.2;
  if ($('cam-lerp'))   $('cam-lerp').value    = cs.camLerp      ?? 0.10;
  if ($('cam-fov'))    $('cam-fov').value     = cs.camFOV       ?? 65;
}
export function refreshCamPanel() { _refreshCamPanel(); }

// ----------------------------------------------------------------
// EFFECTS
// ----------------------------------------------------------------
export function attachFX() {
  const ent = S.selEnt; if (!ent) { showToast('Selecione um objeto primeiro.'); return; }
  const fx  = document.getElementById('fx-loop-select')?.value;
  if (!fx) { showToast('Selecione um efeito.'); return; }
  const offsetY = parseFloat(document.getElementById('fx-offset-y')?.value) || 0.5;
  Effects.attachEffect(ent, fx, offsetY);
  _refreshFXList(ent);
  showToast('✓ Efeito ' + fx + ' adicionado a ' + ent.name);
}
export function detachFX() {
  const ent = S.selEnt; if (!ent) return;
  const fx  = document.getElementById('fx-loop-select')?.value; if (!fx) return;
  Effects.detachEffect(ent, fx); _refreshFXList(ent);
}
export function spawnFX() {
  const fx  = document.getElementById('fx-event-select')?.value;
  const pos = S.selEnt?.mesh?.position?.clone() || new THREE.Vector3(0, 1, 0);
  if (!fx) return;
  Effects.spawn(fx, pos); showToast('▶ ' + fx + ' preview');
}
function _refreshFXList(ent) {
  const el   = document.getElementById('fx-active-list'); if (!el) return;
  const list = ent._effects || [];
  el.textContent = list.length ? list.map(e => e.effect + ' (Y+' + e.offsetY + ')').join(', ') : 'Nenhum efeito ativo';
}

// ----------------------------------------------------------------
// FULLSCREEN
// ----------------------------------------------------------------
export function toggleFullscreen() {
  const vp = document.getElementById('vp-wrap');
  if (!document.fullscreenElement) (vp.requestFullscreen || vp.webkitRequestFullscreen).call(vp);
  else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
}
document.addEventListener('fullscreenchange', () => {
  document.getElementById('btn-full')?.classList.toggle('active', !!document.fullscreenElement);
  onResize();
});

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------
export function exportGameHTML() { exportGame(); }

// ----------------------------------------------------------------
// INSPECTOR ACTIONS
// ----------------------------------------------------------------
export function deleteSel() {
  if (!S.selEnt) return;
  if (outMesh) { outMesh.parent?.remove(outMesh); outMesh = null; }
  Ents.removeEnt(S.selEnt);
  S.setSelEnt(null); Gizmos.gGrp.visible = false;
  Inspector.refresh(); Inspector.refreshHier(); updStatus();
}
export function dupSel() {
  if (!S.selEnt) return;
  const e = Ents.createEnt(S.selEnt.type, S.selEnt.name + '_copy');
  e.mesh.position.copy(S.selEnt.mesh.position).addScalar(.6);
  e.mesh.rotation.copy(S.selEnt.mesh.rotation);
  e.mesh.scale.copy(S.selEnt.mesh.scale);
  selectEnt(e);
}
export function focusSel()    { if (S.selEnt) { orb.tgt.copy(S.selEnt.mesh.position); orb.update(); } }
export function resetXf()     { Inspector.resetXf(); Gizmos.update(S.selEnt); }
export function applyImpulse() {
  const iy = +document.getElementById('imp-y').value || 5;
  Physics.applyImpulse(S.selEnt, iy);
}
export function togVis(e, id) {
  e.stopPropagation();
  const ent = S.entities.find(e => e.id === id); if (!ent) return;
  ent.visible = !ent.visible; ent.mesh.visible = ent.visible; Inspector.refreshHier();
}

// ----------------------------------------------------------------
// SCRIPTS
// ----------------------------------------------------------------
export function addScript()       { if (!S.selEnt) return; const n = ScriptEd.add(S.selEnt); Inspector.refreshSc(); ScriptEd.open(S.selEnt, n); }
export function openSCEditor(n)   { ScriptEd.open(S.selEnt, n); }
export function rmScript(n)       { ScriptEd.remove(S.selEnt, n); Inspector.refreshSc(); }
export function applyScript()     { ScriptEd.apply(S.selEnt); Inspector.refreshSc(); }
export function closeSCEditor()   { ScriptEd.close(); }

// ----------------------------------------------------------------
// KEYBINDS
// ----------------------------------------------------------------
export function startListen(action) {
  if (!S.selEnt?.controllable) return;
  const el = document.getElementById('kbi-' + action); if (!el) return;
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
export function exportScene()   { Serializer.exportScene(); }
export function importScene(ev) { Serializer.importScene(ev.target.files[0], () => { Inspector.refresh(); Inspector.refreshHier(); updStatus(); }); ev.target.value = ''; }
export function importGLTF(ev)  { Serializer.importGLTF(ev.target.files[0], ent => { selectEnt(ent); Inspector.refreshHier(); updStatus(); }); ev.target.value = ''; }

// ----------------------------------------------------------------
// KEYBOARD SHORTCUTS
// ----------------------------------------------------------------
document.addEventListener('keydown', e => {
  if (Inspector.onKeyForRebind(e)) return;

  if (S.pvActive) {
    e.preventDefault();
    if (e.key === 'Escape') togglePreview();
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (document.getElementById('sc-overlay').classList.contains('open')) return;

  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
  }

  switch (e.key) {
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
    `${S.entities.length} obj${S.selEnt ? ' — ' + S.selEnt.name : ''}${S.playing ? ' | ▶' : ''}${S.pvActive ? ' | ◎' : ''}`;
}

// ----------------------------------------------------------------
// RENDER LOOP
// ----------------------------------------------------------------
Ents.buildDefaultScene();
Inspector.refreshHier();
Inspector.refresh();
updStatus();

let last = performance.now(), frames = 0, fpsT = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now(), dt = Math.min((now - last) / 1000, .05); last = now;
  frames++; fpsT += dt;
  if (fpsT >= .5) {
    document.getElementById('info-fps').textContent = 'FPS: ' + Math.round(frames / fpsT);
    document.getElementById('info-tri').textContent = 'Tri: ' + S.renderer.info.render.triangles.toLocaleString();
    document.getElementById('info-obj').textContent = 'Obj: ' + S.entities.length;
    frames = 0; fpsT = 0; updStatus();
  }

  Physics.step(dt);
  Collision.step();
  Combat.tickHealth(dt);
  Effects.update(dt);

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