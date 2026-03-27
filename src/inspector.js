// ================================================================
// inspector.js — Right panel: Transform / Physics / Char / Scripts
// ================================================================
import * as S from './state.js';
import * as THREE from 'three';

const $ = id => document.getElementById(id);

// ----------------------------------------------------------------
// TAB SWITCHING
// ----------------------------------------------------------------
const TAB_NAMES = ['xform','physics','ctrl','anim','effects','camera','scripts'];
const TAB_META = {'xform': ('⬡', 'Transform'), 'physics': ('⚙', 'Física / Collider'), 'ctrl': ('🎮', 'Controller'), 'anim': ('▶', 'Animações'), 'effects': ('✨', 'Efeitos Especiais'), 'camera': ('◎', 'Câmera'), 'scripts': ('{}', 'Scripts')};

export function switchTab(name) {
  document.querySelectorAll('.ins-tab').forEach((t,i) => t.classList.toggle('active', TAB_NAMES[i]===name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id==='tab-'+name));
  // Update content header
  const meta = TAB_META[name];
  if (meta) {
    const iconEl = document.getElementById('ins-content-hdr')?.querySelector('.hdr-icon');
    const txtEl  = document.getElementById('ins-content-hdr-txt');
    if (iconEl) iconEl.textContent = meta[0];
    if (txtEl)  txtEl.textContent  = meta[1];
  }
}
export function toggleSec(hdr)     { hdr.closest('.ins-sec').classList.toggle('coll'); }
export function toggleCharSec(hdr) { const b=hdr.nextElementSibling; b.style.display=b.style.display==='none'?'':'none'; }

// ----------------------------------------------------------------
// FULL REFRESH
// ----------------------------------------------------------------
export function refresh() {
  const has = !!S.selEnt;
  ['nsel-xf','nsel-phy','nsel-sc'].forEach(id => $(id).style.display = has?'none':'flex');
  ['xf-fields','phy-fields','sc-fields'].forEach(id => $(id).style.display = has?'block':'none');

  const hasChar = has && !!S.selEnt.controllable;
  $('nsel-ctrl').style.display  = hasChar ? 'none' : 'flex';
  $('ctrl-fields').style.display = hasChar ? 'block' : 'none';
  $('nsel-ctrl').querySelector('.no-sel-txt').textContent =
    has ? 'Sem componente Controller\n(Add > Humanoid, Veículo, Moto, Cavalo...)' : 'Nenhum objeto\nselecionado';

  if (!has) return;
  refreshXf();
  refreshPhy();
  if (hasChar) refreshControllable();
  refreshSc();
}

// ----------------------------------------------------------------
// TRANSFORM
// ----------------------------------------------------------------
export function refreshXf() {
  if (!S.selEnt) return;
  const m = S.selEnt.mesh, f = v => parseFloat(v.toFixed(3));
  $('px').value=f(m.position.x); $('py').value=f(m.position.y); $('pz').value=f(m.position.z);
  $('rx').value=f(m.rotation.x*180/Math.PI); $('ry').value=f(m.rotation.y*180/Math.PI); $('rz').value=f(m.rotation.z*180/Math.PI);
  $('sx').value=f(m.scale.x); $('sy').value=f(m.scale.y); $('sz').value=f(m.scale.z);
  $('obj-name').value=S.selEnt.name;
  $('obj-vis').checked=S.selEnt.visible;
  $('obj-layer').value=S.selEnt.layer||'default';
}
export function applyXf() {
  if (!S.selEnt) return;
  const m = S.selEnt.mesh;
  m.position.set(+$('px').value||0, +$('py').value||0, +$('pz').value||0);
  m.rotation.set((+$('rx').value||0)*Math.PI/180, (+$('ry').value||0)*Math.PI/180, (+$('rz').value||0)*Math.PI/180);
  m.scale.set(+$('sx').value||1, +$('sy').value||1, +$('sz').value||1);
}
export function applyName() { if (S.selEnt) { S.selEnt.name = $('obj-name').value; refreshHier(); } }
export function applyVis()  { if (S.selEnt) { S.selEnt.visible = $('obj-vis').checked; S.selEnt.mesh.visible = S.selEnt.visible; refreshHier(); } }
export function resetXf()   { if (!S.selEnt) return; S.selEnt.mesh.position.set(0,0,0); S.selEnt.mesh.rotation.set(0,0,0); S.selEnt.mesh.scale.set(1,1,1); refreshXf(); }

// ----------------------------------------------------------------
// PHYSICS
// ----------------------------------------------------------------
export function refreshPhy() {
  if (!S.selEnt?.physics) return;
  const ph = S.selEnt.physics;
  $('ph-on').checked=ph.enabled; $('ph-type').value=ph.type||'dynamic';
  $('ph-mass').value=ph.mass||1; $('ph-fric').value=ph.friction||.5;
  $('ph-rest').value=ph.restitution||.3; $('ph-grav').checked=ph.gravity!==false;
  $('ph-col').value=ph.collider||'box';
}
export function applyPhy() {
  if (!S.selEnt?.physics) return;
  const ph = S.selEnt.physics;
  ph.enabled=$('ph-on').checked; ph.type=$('ph-type').value;
  ph.mass=+$('ph-mass').value; ph.friction=+$('ph-fric').value;
  ph.restitution=+$('ph-rest').value; ph.gravity=$('ph-grav').checked;
  ph.collider=$('ph-col').value;
}
// ================================================================
// Collider debug visualizer
// Strategy: attach helper as CHILD of ent.mesh so it follows for free.
// Size is computed from the mesh's own bounding box in LOCAL space,
// so it stays tight regardless of position/rotation/scale.
// ================================================================
const _colHelpers = new Map(); // ent.id → { mesh, ent }
const _COL_MAT = new THREE.MeshBasicMaterial({
  color: 0x3ecf8e, transparent: true, opacity: 0.22,
  wireframe: true, depthTest: false,
});

function _buildCapsuleGeo(rx, h) {
  // A proper capsule = cylinder body + two hemisphere caps merged via BufferGeometry
  // We approximate with a merged geometry for performance
  const segs = 12, rings = 6;
  const positions = [], indices = [];
  let vi = 0;

  // Helper to push vertex
  const pv = (x, y, z) => { positions.push(x, y, z); return vi++; };

  // Bottom hemisphere (y from -rx to 0, offset -h/2)
  for (let r = 0; r <= rings; r++) {
    const phi = (Math.PI / 2) * (r / rings); // 0 → π/2
    const y   = -Math.cos(phi) * rx;
    const rad = Math.sin(phi) * rx;
    for (let s = 0; s <= segs; s++) {
      const theta = (2 * Math.PI * s) / segs;
      pv(Math.cos(theta) * rad, y - h / 2, Math.sin(theta) * rad);
    }
  }

  // Cylinder body (y from -h/2 to h/2)
  for (let r = 0; r <= 1; r++) {
    const y = r === 0 ? -h / 2 : h / 2;
    for (let s = 0; s <= segs; s++) {
      const theta = (2 * Math.PI * s) / segs;
      pv(Math.cos(theta) * rx, y, Math.sin(theta) * rx);
    }
  }

  // Top hemisphere (y from 0 to rx, offset h/2)
  for (let r = 0; r <= rings; r++) {
    const phi = (Math.PI / 2) * (r / rings);
    const y   = Math.sin(phi) * rx;
    const rad = Math.cos(phi) * rx;
    for (let s = 0; s <= segs; s++) {
      const theta = (2 * Math.PI * s) / segs;
      pv(Math.cos(theta) * rad, y + h / 2, Math.sin(theta) * rad);
    }
  }

  // Build wireframe indices (just longitudinal + latitudinal lines)
  const totalRows = (rings + 1) + 2 + (rings + 1);
  const cols = segs + 1;
  for (let row = 0; row < totalRows - 1; row++) {
    for (let col = 0; col < segs; col++) {
      const a = row * cols + col;
      const b = row * cols + col + 1;
      const c = (row + 1) * cols + col;
      indices.push(a, b, b, c, c, a);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

export function toggleColViz() {
  const ent = S.selEnt;
  if (!ent?.mesh) return;
  const show = $('ph-show').checked;

  // Remove existing helper (detach from mesh)
  const prev = _colHelpers.get(ent.id);
  if (prev) { ent.mesh.remove(prev); _colHelpers.delete(ent.id); }
  if (!show) return;

  const col = ent.physics?.collider || 'box';

  // Compute bbox in LOCAL space (unscaled) so geometry matches visual exactly
  // We temporarily reset scale to get local-space bounds, then restore
  const savedScale = ent.mesh.scale.clone();
  ent.mesh.scale.set(1, 1, 1);
  const localBox = new THREE.Box3().setFromObject(ent.mesh);
  ent.mesh.scale.copy(savedScale);

  const size   = new THREE.Vector3(); localBox.getSize(size);
  const center = new THREE.Vector3(); localBox.getCenter(center);

  // Adjust for scale
  size.multiply(savedScale);
  center.multiply(savedScale);

  let geo;
  if (col === 'sphere') {
    const r = Math.max(size.x, size.y, size.z) * 0.5;
    geo = new THREE.SphereGeometry(r, 14, 10);
  } else if (col === 'capsule') {
    const r = Math.max(size.x, size.z) * 0.5;
    const h = Math.max(0.01, size.y - r * 2);
    geo = _buildCapsuleGeo(r, h);
  } else if (col === 'mesh') {
    // Mesh collider: just re-use the bounding box for debug
    geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  } else {
    geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  }

  const helper = new THREE.Mesh(geo, _COL_MAT.clone());
  // Position relative to mesh (local space center offset from pivot)
  helper.position.copy(center);
  helper.userData._isColHelper = true;

  // ATTACH AS CHILD — follows mesh automatically, zero per-frame cost
  ent.mesh.add(helper);
  _colHelpers.set(ent.id, helper);
}

/** No per-frame work needed — helpers are mesh children */
export function updateColHelpers() {
  // Only cleanup orphaned helpers (entity deleted while debug active)
  _colHelpers.forEach((helper, id) => {
    if (!S.entities.find(e => e.id === id)) {
      helper.parent?.remove(helper);
      _colHelpers.delete(id);
    }
  });
}

export function clearColHelpers() {
  _colHelpers.forEach((helper, id) => {
    const ent = S.entities.find(e => e.id === id);
    if (ent) ent.mesh.remove(helper);
    else helper.parent?.remove(helper);
  });
  _colHelpers.clear();
}

// ----------------------------------------------------------------
// CHARACTER
// ----------------------------------------------------------------
// refreshChar / applyChar removed — legacy 'char' system replaced by 'controllable'
export function refreshChar() {}
export function applyChar()   {}

// ----------------------------------------------------------------
// KEYBINDS
// ----------------------------------------------------------------
let listeningFor = null;

export function buildKBUI(kb) {
  const c = $('kb-list'); c.innerHTML = '';
  Object.entries(kb).forEach(([action, bind]) => {
    const row = document.createElement('div'); row.className='kb-row';
    row.innerHTML=`<div class="kb-action">${bind.action}</div><input class="kb-key" id="kbi-${action}" value="${bind.label}" readonly onclick="startListen('${action}')" title="Clique para reatribuir">`;
    c.appendChild(row);
  });
}
export function startListen(action) {
  if (!S.selEnt?.controllable) return; listeningFor=action;
  const el=$('kbi-'+action); el.classList.add('listening'); el.value='...';
}
export function onKeyForRebind(e) {
  if (!listeningFor || !S.selEnt?.controllable) return false;
  e.preventDefault(); e.stopPropagation();
  const lbl = e.key===' '?'Space':e.key.length===1?e.key.toUpperCase():e.key;
  S.selEnt.controllable.keybinds[listeningFor].key   = e.code;
  S.selEnt.controllable.keybinds[listeningFor].label = lbl;
  const el = $('kbi-'+listeningFor);
  if (el) { el.value=lbl; el.classList.remove('listening'); }
  listeningFor = null;
  return true;
}
export function resetKB() {
  if (!S.selEnt?.controllable) return;
  S.selEnt.controllable.keybinds = JSON.parse(JSON.stringify(S.DEF_KB));
  buildKBUI(S.selEnt.controllable.keybinds);
}
export function isListening() { return !!listeningFor; }

// ----------------------------------------------------------------
// SCRIPTS
// ----------------------------------------------------------------
export function refreshSc() {
  if (!S.selEnt) return;
  const list=$('sc-list'); list.innerHTML='';
  (S.selEnt.scripts||[]).forEach(sn => {
    const c=document.createElement('div'); c.className='sc-card';
    c.innerHTML=`<div class="sc-card-hdr"><div class="sc-dot"></div><div class="sc-name-lbl">${sn}</div><span class="sc-edit" onclick="openSCEditor('${sn}')">✎ Editar</span><span class="sc-edit" style="color:var(--red)" onclick="rmScript('${sn}')">✕</span></div><div style="font-size:10px;color:var(--text3);margin-top:3px">onStart · onUpdate · onCollision</div>`;
    list.appendChild(c);
  });
}

// ----------------------------------------------------------------
// HIERARCHY
// ----------------------------------------------------------------
export function refreshHier() {
  const list=$('hier-list'); list.innerHTML='';
  S.entities.forEach(ent => {
    const item=document.createElement('div');
    item.className=`h-item${ent===S.selEnt?' sel':''}${!ent.visible?' hidden':''}`;
    const hasPh=ent.physics?.enabled, hasCtrl=!!ent.controllable;
    item.innerHTML=`<span class="h-item-icon">${S.ICONS[ent.type]||'◻'}</span><span class="h-item-name">${ent.name}</span>${hasCtrl?'<span class="h-tag">ctrl</span>':''}${hasPh?'<span class="h-tag phy">phy</span>':''}<span class="h-item-vis" onclick="togVis(event,${ent.id})">${ent.visible?'◎':'○'}</span>`;
    item.addEventListener('click', () => window._selectEnt(ent));
    list.appendChild(item);
  });
}

// ----------------------------------------------------------------
// CONTROLLABLE (replaces legacy char)
// ----------------------------------------------------------------
export function refreshControllable() {
  const ent = S.selEnt;
  const c   = ent?.controllable;
  if (!c) return;

  // Set type dropdown
  const typeEl = $('ct-type');
  if (typeEl) typeEl.value = c.type;

  // Show correct stats panel (calls back to main.js via window)
  if (window._showCtrlStats) window._showCtrlStats(c.type);

  // Populate stat fields — iterate stats keys
  Object.entries(c.stats).forEach(([k, v]) => {
    const el = $('ct-' + k);
    if (el) el.value = v;
  });

  // Keybinds
  buildKBUI(c.keybinds);
}

export function applyControllable() {
  const c = S.selEnt?.controllable;
  if (!c) return;
  // Read only the keys that belong to this type's stats
  Object.keys(c.stats).forEach(k => {
    const el = $('ct-' + k);
    if (el && el.value !== '') c.stats[k] = parseFloat(el.value) || 0;
  });
}

export function applyLayer() {
  if (!S.selEnt) return;
  S.selEnt.layer = $('obj-layer').value;
}