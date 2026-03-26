// ================================================================
// ui.js — Modal, Toast, Orbit controls, Panel resizers
// ================================================================
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import * as S from './state.js';

// ----------------------------------------------------------------
// MODAL
// ----------------------------------------------------------------
export function showModal(title, body, buttons) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent  = body;
  const acts = document.getElementById('modal-actions');
  acts.innerHTML = '';
  (buttons || [{ label:'OK', cls:'' }]).forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'modal-btn' + (b.cls ? ' '+b.cls : '');
    btn.textContent = b.label;
    btn.onclick = () => {
      document.getElementById('modal-overlay').classList.remove('open');
      if (b.action) b.action();
    };
    acts.appendChild(btn);
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ----------------------------------------------------------------
// TOAST
// ----------------------------------------------------------------
export function showToast(msg) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div'); t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 16px;font-size:11px;color:var(--text);z-index:9999;transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._to); t._to = setTimeout(() => { t.style.opacity='0'; }, 2800);
}

// ----------------------------------------------------------------
// ORBIT CONTROLS
// ----------------------------------------------------------------
export function makeOrbit(cam) {
  const orb = {
    enabled: true, orbiting: false, panning: false,
    lx: 0, ly: 0,
    sph: { th: 0.75, ph: 0.85, r: 15 },
    tgt: new THREE.Vector3(),
  };
  const VP = document.getElementById('vp');

  function update() {
    const { th, ph, r } = orb.sph;
    cam.position.set(
      orb.tgt.x + r*Math.sin(ph)*Math.sin(th),
      orb.tgt.y + r*Math.cos(ph),
      orb.tgt.z + r*Math.sin(ph)*Math.cos(th),
    );
    cam.lookAt(orb.tgt);
  }
  update();

  VP.addEventListener('mousedown', e => {
    if (!orb.enabled || S.pvActive) return;
    if (e.button===2) orb.orbiting = true;
    if (e.button===1) orb.panning  = true;
    orb.lx=e.clientX; orb.ly=e.clientY;
  });
  window.addEventListener('mouseup', () => { orb.orbiting=false; orb.panning=false; });
  window.addEventListener('mousemove', e => {
    if (S.pvActive) return;
    const dx=e.clientX-orb.lx, dy=e.clientY-orb.ly;
    orb.lx=e.clientX; orb.ly=e.clientY;
    if (orb.orbiting) {
      orb.sph.th -= dx*.006;
      orb.sph.ph = Math.max(.05, Math.min(Math.PI-.05, orb.sph.ph-dy*.006));
      update();
    }
    if (orb.panning) {
      const r = new THREE.Vector3().crossVectors(cam.getWorldDirection(new THREE.Vector3()), cam.up).normalize();
      orb.tgt.addScaledVector(r, -dx*.013).addScaledVector(cam.up, dy*.013);
      update();
    }
  });
  VP.addEventListener('wheel', e => {
    if (S.pvActive) return;
    orb.sph.r = Math.max(1.5, Math.min(300, orb.sph.r*(1+e.deltaY*.001)));
    update();
  }, { passive: true });
  VP.addEventListener('contextmenu', e => e.preventDefault());

  orb.update = update;
  return orb;
}

// ----------------------------------------------------------------
// PANEL RESIZERS
// ----------------------------------------------------------------
export function makeResizer(resizerId, leftId, rightId) {
  let drag = false;
  document.getElementById(resizerId).addEventListener('mousedown', () => { drag=true; });
  window.addEventListener('mouseup',    () => { drag=false; });
  window.addEventListener('mousemove',  e  => {
    if (!drag) return;
    if (leftId)  { const el=document.getElementById(leftId);  el.style.width=Math.max(150,Math.min(400, e.clientX-el.getBoundingClientRect().left))+'px'; }
    if (rightId) { const el=document.getElementById(rightId); el.style.width=Math.max(200,Math.min(500, document.body.clientWidth-e.clientX))+'px'; }
    window.dispatchEvent(new Event('engineresize'));
  });
}

// ----------------------------------------------------------------
// RESIZE
// ----------------------------------------------------------------
export function onResize(renderer, edCam, gCam, pvCvs) {
  const wrap = document.getElementById('vp-wrap');
  const w=wrap.clientWidth, h=wrap.clientHeight;
  renderer.setSize(w,h);
  [edCam,gCam].forEach(c => { c.aspect=w/h; c.updateProjectionMatrix(); });
  pvCvs.width=w; pvCvs.height=h;
}
