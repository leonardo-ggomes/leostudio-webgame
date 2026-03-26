// ================================================================
// gizmos.js — Transform gizmos + nav orientation gizmo
// ================================================================
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import * as S from './state.js';

const VP  = document.getElementById('vp');
const navCvs = document.getElementById('nav-cvs');
const navCtx = navCvs.getContext('2d');

export const gGrp = new THREE.Group();
S.scene.add(gGrp);

let dragging = false, axis = null;
let dragStart = new THREE.Vector3(), dragPlane = new THREE.Plane();
const RAY = new THREE.Raycaster(), MV = new THREE.Vector2();

export function build() {
  gGrp.clear();
  [{a:'x',col:0xe85555},{a:'y',col:0x5bc95b},{a:'z',col:0x5588ff}].forEach(({a,col}) => {
    const mat = new THREE.MeshBasicMaterial({ color:col, depthTest:false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.8,8), mat);
    const tip   = new THREE.Mesh(new THREE.ConeGeometry(.1,.25,8), mat);
    const g = new THREE.Group();
    shaft.position.y = .4; tip.position.y = .925; g.add(shaft, tip);
    if (a==='x') g.rotation.z = -Math.PI/2;
    if (a==='z') g.rotation.x =  Math.PI/2;
    g.renderOrder = 999; g.userData.axis = a; gGrp.add(g);
  });

  [{a:'xy',col:0xe85555,p:[.25,.25,0],r:null},
   {a:'xz',col:0x5bc95b,p:[.25,0,.25],r:[-Math.PI/2,0,0]},
   {a:'yz',col:0x5588ff,p:[0,.25,.25],r:[0,0,-Math.PI/2]}
  ].forEach(({a,col,p,r}) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(.22,.22),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.22,side:THREE.DoubleSide,depthTest:false})
    );
    m.position.set(...p); if (r) m.rotation.set(...r);
    m.renderOrder = 999; m.userData.axis = a; gGrp.add(m);
  });
}

export function update(selEnt) {
  if (!selEnt?.mesh || S.pvActive) { gGrp.visible = false; return; }
  gGrp.visible = true;
  gGrp.position.copy(selEnt.mesh.position);
  gGrp.scale.setScalar(S.edCam.position.distanceTo(gGrp.position) * .11);
}

export function isDragging() { return dragging; }

export function onMouseDown(e, selEnt, orb) {
  if (e.button !== 0 || !selEnt || S.pvActive) return false;
  const r = VP.getBoundingClientRect();
  MV.x = ((e.clientX-r.left)/r.width)*2-1;
  MV.y = -((e.clientY-r.top)/r.height)*2+1;
  RAY.setFromCamera(MV, S.edCam);
  const gms = []; gGrp.traverse(c => { if (c.isMesh) gms.push(c); });
  const hits = RAY.intersectObjects(gms);
  if (!hits.length) return false;

  dragging = true; orb.enabled = false;
  axis = hits[0].object.parent?.userData.axis || hits[0].object.userData.axis;
  const cd = new THREE.Vector3(); S.edCam.getWorldDirection(cd);
  dragPlane.setFromNormalAndCoplanarPoint(cd, selEnt.mesh.position);
  const pt = new THREE.Vector3(); RAY.ray.intersectPlane(dragPlane, pt);
  dragStart.copy(pt).sub(selEnt.mesh.position);
  return true;
}

export function onMouseMove(e, selEnt) {
  if (!dragging || !selEnt) return;
  const r = VP.getBoundingClientRect();
  MV.x = ((e.clientX-r.left)/r.width)*2-1;
  MV.y = -((e.clientY-r.top)/r.height)*2+1;
  RAY.setFromCamera(MV, S.edCam);
  const pt = new THREE.Vector3();
  if (!RAY.ray.intersectPlane(dragPlane, pt)) return;

  const delta = pt.clone().sub(selEnt.mesh.position).sub(dragStart);
  const a = axis;

  if (S.gizmoMode === 'translate') {
    if (a==='x'||a==='xy'||a==='xz') selEnt.mesh.position.x += delta.x;
    if (a==='y'||a==='xy'||a==='yz') selEnt.mesh.position.y += delta.y;
    if (a==='z'||a==='xz'||a==='yz') selEnt.mesh.position.z += delta.z;
    if (S.snap.grid) {
      selEnt.mesh.position.x = Math.round(selEnt.mesh.position.x);
      selEnt.mesh.position.y = Math.round(selEnt.mesh.position.y);
      selEnt.mesh.position.z = Math.round(selEnt.mesh.position.z);
    }
  } else if (S.gizmoMode === 'scale') {
    const s = 1 + (delta.x + delta.y) * .5;
    if      (a==='x') selEnt.mesh.scale.x = Math.max(.01, selEnt.mesh.scale.x * s);
    else if (a==='y') selEnt.mesh.scale.y = Math.max(.01, selEnt.mesh.scale.y * s);
    else if (a==='z') selEnt.mesh.scale.z = Math.max(.01, selEnt.mesh.scale.z * s);
    else selEnt.mesh.scale.multiplyScalar(Math.max(.5, Math.min(2, 1 + (delta.x+delta.y)*.3)));
  } else if (S.gizmoMode === 'rotate') {
    const ang = (delta.x + delta.y) * .8;
    const sn  = S.snap.angle ? Math.round(ang/(Math.PI/12))*(Math.PI/12) : ang;
    if      (a==='x') selEnt.mesh.rotation.x += sn * .05;
    else if (a==='y') selEnt.mesh.rotation.y += sn * .05;
    else              selEnt.mesh.rotation.z += sn * .05;
  }

  RAY.ray.intersectPlane(dragPlane, pt);
  dragStart.copy(pt).sub(selEnt.mesh.position);

  // HUD
  const hud = document.getElementById('xform-hud');
  const p = selEnt.mesh.position;
  hud.textContent = `X:${p.x.toFixed(2)} Y:${p.y.toFixed(2)} Z:${p.z.toFixed(2)}`;
  hud.classList.add('on');
}

export function onMouseUp(orb) {
  if (!dragging) return;
  dragging = false; orb.enabled = true;
  document.getElementById('xform-hud').classList.remove('on');
}

// --- Nav gizmo (orientation cube) ---
export function drawNav() {
  navCtx.clearRect(0, 0, 76, 76);
  const cx=38, cy=38, r=26;
  const cam = S.pvActive ? S.gCam : S.edCam;
  const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
  const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
  const up    = new THREE.Vector3().crossVectors(right, dir).normalize();

  const axs = [
    {l:'X', d:[1,0,0],  c:'#e85555'}, {l:'Y', d:[0,1,0],  c:'#5bc95b'}, {l:'Z', d:[0,0,1],  c:'#5588ff'},
    {l:'-X',d:[-1,0,0], c:'#5a2a2a'}, {l:'-Y',d:[0,-1,0], c:'#2a4a2a'}, {l:'-Z',d:[0,0,-1], c:'#2a3a5a'},
  ];
  const proj = axs.map(ax => {
    const v = new THREE.Vector3(...ax.d);
    return { ...ax, x: cx+v.dot(right)*r, y: cy-v.dot(up)*r, z: v.dot(dir) };
  }).sort((a,b) => a.z-b.z);

  proj.forEach(ax => {
    navCtx.beginPath(); navCtx.moveTo(cx,cy); navCtx.lineTo(ax.x,ax.y);
    navCtx.strokeStyle=ax.c; navCtx.lineWidth=1.5; navCtx.globalAlpha=.35+ax.z*.3; navCtx.stroke();
  });
  proj.forEach(ax => {
    const pos = !ax.l.startsWith('-');
    navCtx.globalAlpha = .5+ax.z*.3;
    navCtx.beginPath(); navCtx.arc(ax.x,ax.y,pos?8:5,0,Math.PI*2); navCtx.fillStyle=ax.c; navCtx.fill();
    if (pos) {
      navCtx.fillStyle='#fff'; navCtx.font='bold 8px monospace';
      navCtx.textAlign='center'; navCtx.textBaseline='middle'; navCtx.globalAlpha=.95;
      navCtx.fillText(ax.l, ax.x, ax.y);
    }
  });
  navCtx.globalAlpha = 1;
}
