// ================================================================
// inspector.js — Right panel: Transform / Physics / Char / Scripts
// ================================================================
import * as S from './state.js';
import * as THREE from 'three';

const $ = id => document.getElementById(id);

// ----------------------------------------------------------------
// TAB SWITCHING
// ----------------------------------------------------------------
const TAB_NAMES = ['xform','physics','ctrl','anim','scripts'];
export function switchTab(name) {
  document.querySelectorAll('.ins-tab').forEach((t,i) => t.classList.toggle('active', TAB_NAMES[i]===name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id==='tab-'+name));
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
    has ? 'Sem componente Controllable\n(Add > Humanoid ou Veículo)' : 'Nenhum objeto\nselecionado';

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
export function toggleColViz(outMesh) {
  if (!outMesh||!S.selEnt) return;
  const mat = $('ph-show').checked
    ? new THREE.MeshBasicMaterial({color:0x3ecf8e,side:THREE.BackSide,transparent:true,opacity:.18,wireframe:true})
    : new THREE.MeshBasicMaterial({color:0x5b8cff,side:THREE.BackSide,transparent:true,opacity:.28});
  outMesh.material = mat;
}

// ----------------------------------------------------------------
// CHARACTER
// ----------------------------------------------------------------
export function refreshChar() {
  if (!S.selEnt?.char) return;
  const ch = S.selEnt.char;
  $('ch-spd').value=ch.speed; $('ch-spr').value=ch.sprint; $('ch-jmp').value=ch.jump;
  $('ch-acc').value=ch.accel; $('ch-rot').value=ch.rotSpd;
  $('ch-camy').value=ch.camY; $('ch-camd').value=ch.camD;
  ['aim','car','cov','rol','crc','int'].forEach(k => {
    const el=$('ca-'+k); if (el) el.checked=ch.actions?.[k]||false;
  });
  buildKBUI(ch.keybinds);
}
export function applyChar() {
  if (!S.selEnt?.char) return;
  const ch = S.selEnt.char;
  ch.speed=+$('ch-spd').value; ch.sprint=+$('ch-spr').value; ch.jump=+$('ch-jmp').value;
  ch.accel=+$('ch-acc').value; ch.rotSpd=+$('ch-rot').value;
  ch.camY=+$('ch-camy').value; ch.camD=+$('ch-camd').value;
}

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
  if (!S.selEnt?.char) return; listeningFor=action;
  const el=$('kbi-'+action); el.classList.add('listening'); el.value='...';
}
export function onKeyForRebind(e) {
  if (!listeningFor || !S.selEnt?.char) return false;
  e.preventDefault(); e.stopPropagation();
  const lbl = e.key===' '?'Space':e.key.length===1?e.key.toUpperCase():e.key;
  S.selEnt.char.keybinds[listeningFor].key   = e.code;
  S.selEnt.char.keybinds[listeningFor].label = lbl;
  const el = $('kbi-'+listeningFor);
  if (el) { el.value=lbl; el.classList.remove('listening'); }
  listeningFor = null;
  return true;
}
export function resetKB() {
  if (!S.selEnt?.char) return;
  S.selEnt.char.keybinds = JSON.parse(JSON.stringify(S.DEF_KB));
  buildKBUI(S.selEnt.char.keybinds);
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
  const has = !!ent?.controllable;
  const c = ent?.controllable;
  if (!has) return;

  // Stats
  const stats = c.stats;
  Object.entries(stats).forEach(([k, v]) => {
    const el = document.getElementById('ct-' + k);
    if (el) el.value = v;
  });

  // Keybinds
  buildKBUI(c.keybinds);
}

export function applyControllable() {
  const c = S.selEnt?.controllable;
  if (!c) return;
  Object.keys(c.stats).forEach(k => {
    const el = document.getElementById('ct-' + k);
    if (el) c.stats[k] = parseFloat(el.value) || 0;
  });
}
