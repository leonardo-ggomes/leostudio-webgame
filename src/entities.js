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
      physics: mkPhysics({ enabled: false }),
      controllable: makeControllable('vehicle'),
    });
  }

  // ---- Helicopter ----
  if (type === 'helicopter') {
    const grp = new THREE.Group();
    // Body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.4, .5, 2, 10), mkMat(0x336688));
    body.rotation.z = Math.PI / 2;
    // Tail boom
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, 2.2, 8), mkMat(0x2a5577));
    tail.rotation.z = Math.PI / 2; tail.position.set(1.8, .15, 0);
    // Main rotor disc
    const rotorDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, .04, 16), new THREE.MeshStandardMaterial({ color: 0x88aabb, transparent: true, opacity: .45, side: THREE.DoubleSide }));
    rotorDisc.position.y = .7; rotorDisc.userData.rotor = true;
    // Tail rotor
    const tailRotor = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .04, 8), new THREE.MeshStandardMaterial({ color: 0x88aabb, transparent: true, opacity: .45, side: THREE.DoubleSide }));
    tailRotor.rotation.z = Math.PI / 2; tailRotor.position.set(2.9, .3, .15); tailRotor.userData.tailRotor = true;
    // Skids
    const skidGeo = new THREE.BoxGeometry(2, .06, .06);
    const skidMat = mkMat(0x222222);
    const skidL = new THREE.Mesh(skidGeo, skidMat); skidL.position.set(0, -.45, .4);
    const skidR = new THREE.Mesh(skidGeo, skidMat); skidR.position.set(0, -.45, -.4);
    grp.add(body, tail, rotorDisc, tailRotor, skidL, skidR);
    [body, tail, skidL, skidR].forEach(m => { m.castShadow = true; });
    S.scene.add(grp);
    return mkEnt(type, name || 'Helicóptero', grp, {
      layer: 'vehicle',
      physics: mkPhysics({ enabled: false }),
      controllable: makeControllable('helicopter'),
    });
  }

  // ---- Aircraft (fixed-wing) ----
  if (type === 'aircraft') {
    const grp = new THREE.Group();
    // Fuselage
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(.25, .35, 3.5, 10), mkMat(0xd4d0c8));
    fuse.rotation.z = Math.PI / 2;
    // Wings
    const wingGeo = new THREE.BoxGeometry(5, .08, .9);
    const wing = new THREE.Mesh(wingGeo, mkMat(0xbcb8b0));
    // Horizontal stabilizer
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(2, .06, .5), mkMat(0xbcb8b0));
    hStab.position.set(-1.6, 0, 0);
    // Vertical stabilizer
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(.06, .6, .5), mkMat(0xbcb8b0));
    vStab.position.set(-1.6, .3, 0);
    // Propeller disc
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .04, 12), new THREE.MeshStandardMaterial({ color: 0x888880, transparent: true, opacity: .5, side: THREE.DoubleSide }));
    prop.rotation.x = Math.PI / 2; prop.position.set(1.85, 0, 0); prop.userData.propeller = true;
    // Engine nacelle
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, .5, 10), mkMat(0x888880));
    nacelle.rotation.z = Math.PI / 2; nacelle.position.set(1.65, 0, 0);
    grp.add(fuse, wing, hStab, vStab, prop, nacelle);
    [fuse, wing, hStab, vStab, nacelle].forEach(m => { m.castShadow = true; });
    S.scene.add(grp);
    return mkEnt(type, name || 'Avião', grp, {
      layer: 'vehicle',
      physics: mkPhysics({ enabled: false }),
      controllable: makeControllable('aircraft'),
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

/** Load (or reload) a GLB into any controllable entity */
export function loadControllableGLB(ent, url) { return _loadHumanoidGLB(ent, url); }

/** Load (or reload) a GLB into any controllable entity */
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
