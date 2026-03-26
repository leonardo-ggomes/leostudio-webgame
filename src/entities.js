// ================================================================
// entities.js — Entity factory and scene management
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';
import { makeControllable } from './controllableSystem.js';
import { loadGLB } from './animationManager.js';

function mkMat(col) {
  return new THREE.MeshStandardMaterial({ color: col, roughness: .55, metalness: .1 });
}

export function mkPhysics(ovr = {}) {
  return Object.assign({
    enabled: false, type: 'dynamic', mass: 1,
    gravity: true, friction: .5, restitution: .3, collider: 'box',
    velocity: new THREE.Vector3(), angularVel: new THREE.Vector3(), grounded: false,
  }, ovr);
}

function mkEnt(type, name, mesh, extra = {}) {
  const ent = {
    id: S.nextId, name, type, mesh,
    visible: true, layer: 'default',
    physics: mkPhysics(),
    controllable: null,
    animMgr: null,
    scripts: [], scriptCodes: {}, _si: {},
    ...extra,
  };
  S.setNextId(S.nextId + 1);
  S.entities.push(ent);
  return ent;
}

export function createEnt(type, name) {
  const col = S.COLS[(S.nextId - 1) % S.COLS.length];

  // ---- Humanoid (GLB-backed) ----
  if (type === 'humanoid') {
    const pivot = new THREE.Group();
    S.scene.add(pivot);
    const ent = mkEnt(type, name || 'Humanoid', pivot, {
      layer: 'player',
      physics: mkPhysics({ enabled: false, collider: 'capsule' }), // controller owns movement, no physics.step
      controllable: makeControllable('humanoid'),
    });
    // Load default model
    _loadHumanoidGLB(ent, 'assets/human_model.glb');
    return ent;
  }

  // ---- Vehicle ----
  if (type === 'vehicle') {
    const grp = new THREE.Group();
    // Placeholder box body
    const body  = new THREE.Mesh(new THREE.BoxGeometry(2, .8, 4), mkMat(0xe05533));
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, .7, 2), mkMat(0xc04422));
    cabin.position.set(0, .75, -.3);
    body.castShadow = true; cabin.castShadow = true;
    // Wheels
    const wGeo = new THREE.CylinderGeometry(.35, .35, .25, 16);
    const wMat = mkMat(0x222222);
    const wheelPositions = [[-1.1,.1,1.4],[1.1,.1,1.4],[-1.1,.1,-1.4],[1.1,.1,-1.4]];
    wheelPositions.forEach(([x,y,z], i) => {
      const w = new THREE.Mesh(wGeo, wMat);
      w.rotation.z = Math.PI/2; w.position.set(x,y,z);
      if (i < 2) w.userData.wheelFront = true;
      grp.add(w);
    });
    grp.add(body, cabin);
    grp.castShadow = true;
    S.scene.add(grp);
    return mkEnt(type, name || 'Veículo', grp, {
      layer: 'vehicle',
      physics: mkPhysics({ enabled: true, type: 'kinematic' }),
      controllable: makeControllable('vehicle'),
    });
  }

  // ---- Lights ----
  if (type === 'light-point') {
    const pl = new THREE.PointLight(0xffffff, 1.2, 12);
    const helper = new THREE.PointLightHelper(pl, .3);
    S.scene.add(pl, helper);
    return mkEnt(type, name || 'PointLight', pl, { helper });
  }
  if (type === 'light-dir') {
    const dl = new THREE.DirectionalLight(0xfff4e0, .9);
    dl.position.set(3, 6, 3);
    const helper = new THREE.DirectionalLightHelper(dl, 1);
    S.scene.add(dl, helper);
    return mkEnt(type, name || 'DirLight', dl, { helper });
  }

  // ---- Empty / Camera ----
  if (type === 'empty') {
    const g = new THREE.Group(); g.add(new THREE.AxesHelper(.5)); S.scene.add(g);
    return mkEnt(type, name || 'Empty', g);
  }
  if (type === 'camera') {
    const c = new THREE.PerspectiveCamera(60, 1, .1, 100); c.position.set(0, 1, 5);
    const helper = new THREE.CameraHelper(c);
    S.scene.add(c, helper);
    return mkEnt(type, name || 'GameCamera', c, { helper });
  }

  // ---- Primitives ----
  let mesh;
  switch (type) {
    case 'sphere':   mesh = new THREE.Mesh(new THREE.SphereGeometry(.5, 32, 16), mkMat(col)); break;
    case 'cylinder': mesh = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 1, 32), mkMat(col)); break;
    case 'plane':    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mkMat(col)); mesh.rotation.x = -Math.PI/2; break;
    default:         mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mkMat(col));
  }
  mesh.castShadow = true; mesh.receiveShadow = true;
  S.scene.add(mesh);
  return mkEnt(type, name || (type[0].toUpperCase()+type.slice(1)+' '+S.nextId), mesh);
}

/** Load (or reload) a GLB into an existing humanoid entity */
export async function _loadHumanoidGLB(ent, url) {
  try {
    const { scene: model, animMgr } = await loadGLB(url);
    // Remove previous model children (if reloading)
    while (ent.mesh.children.length) ent.mesh.remove(ent.mesh.children[0]);
    ent.mesh.add(model);
    ent.animMgr = animMgr;
    // Reset currentState so setState('idle') always fires, even if called before
    if (animMgr) {
      animMgr.currentState = null;
      animMgr.setState('idle');
    }
    console.log(`[EngineLeo] GLB loaded: ${url} — ${animMgr?.clips.length || 0} clips`);
    // Notify inspector to refresh anim tab if this entity is selected
    if (window._onEntAnimLoaded) window._onEntAnimLoaded(ent);
  } catch(e) {
    console.warn('[DE] GLB load failed:', url, e);
    // Fallback: capsule placeholder
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 1.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x3a5fcd }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf4c08a }));
    body.position.y = .6; head.position.y = 1.42;
    ent.mesh.add(body, head);
  }
}

export function buildDefaultScene() {
  const g = createEnt('plane', 'Chão');
  g.mesh.scale.set(15, 15, 15);
  g.mesh.material.color.set(0x1a2416); g.mesh.material.roughness = .9;
  g.physics.enabled = true; g.physics.type = 'static';

  const c = createEnt('cube', 'Cubo');
  c.mesh.position.set(-3, .5, 0); c.mesh.material.color.set(0x5b8cff);

  const player = createEnt('humanoid', 'Jogador');
  player.mesh.position.set(0, 0, 3);

  const car = createEnt('vehicle', 'Carro');
  car.mesh.position.set(5, 0, 0);

  createEnt('light-dir', 'Sol');
}

export function removeEnt(ent) {
  S.scene.remove(ent.mesh);
  if (ent.helper) S.scene.remove(ent.helper);
  S.setEntities(S.entities.filter(e => e !== ent));
}
