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

  // ---- Motorcycle ----
  if (type === 'motorcycle') {
    const grp = new THREE.Group();
    const bodyMat = mkMat(0xcc2211);
    const darkMat = mkMat(0x111111);
    // Frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(.25, .55, 1.6), bodyMat);
    frame.position.y = .5;
    // Tank
    const tank = new THREE.Mesh(new THREE.BoxGeometry(.28, .28, .7), bodyMat);
    tank.position.set(0, .85, .15);
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(.22, .1, .6), mkMat(0x222222));
    seat.position.set(0, .92, -.22);
    // Handlebars
    const hbar = new THREE.Mesh(new THREE.BoxGeometry(.7, .06, .12), darkMat);
    hbar.position.set(0, 1.02, .6); hbar.userData.handlebar = true;
    // Wheels
    const wGeo = new THREE.TorusGeometry(.32, .08, 8, 18);
    const wFront = new THREE.Mesh(wGeo, darkMat);
    const wRear  = new THREE.Mesh(wGeo, darkMat);
    wFront.rotation.y = Math.PI/2; wFront.position.set(0, .32, .72);
    wRear.rotation.y  = Math.PI/2; wRear.position.set(0, .32, -.72);
    wFront.userData.wheel = true; wRear.userData.wheel = true;
    // Exhaust
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(.04, .06, .7, 8), mkMat(0x888888));
    exh.rotation.z = Math.PI/2; exh.position.set(.22, .3, -.6);
    grp.add(frame, tank, seat, hbar, wFront, wRear, exh);
    [frame, tank, seat, hbar, exh].forEach(m => m.castShadow = true);
    S.scene.add(grp);
    return mkEnt(type, name || 'Moto', grp, {
      layer: 'vehicle',
      physics: mkPhysics({ enabled: false }),
      controllable: makeControllable('motorcycle'),
    });
  }

  // ---- Horse ----
  if (type === 'horse') {
    const grp = new THREE.Group();
    const bodyMat  = mkMat(0x8b5e3c);
    const darkMat  = mkMat(0x5a3a1a);
    const hairMat  = mkMat(0x3d2200);
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(.6, .65, 1.5), bodyMat);
    body.position.y = 1.0;
    // Neck
    const neck = new THREE.Mesh(new THREE.BoxGeometry(.3, .55, .35), bodyMat);
    neck.position.set(0, 1.38, .65); neck.rotation.x = -.35;
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(.22, .3, .52), bodyMat);
    head.position.set(0, 1.65, .92);
    // Ears
    const earGeo = new THREE.ConeGeometry(.05, .14, 4);
    const earL = new THREE.Mesh(earGeo, bodyMat); earL.position.set(-.08, 1.82, .86);
    const earR = new THREE.Mesh(earGeo, bodyMat); earR.position.set(.08, 1.82, .86);
    // Mane
    const mane = new THREE.Mesh(new THREE.BoxGeometry(.1, .35, .5), hairMat);
    mane.position.set(0, 1.52, .58);
    // Tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(.1, .45, .15), hairMat);
    tail.position.set(0, .95, -.85);
    // Legs (tagged for animation)
    const legGeo = new THREE.BoxGeometry(.14, .55, .16);
    const legPositions = [
      [-.22, .42, .45], [.22, .42, .45],   // front legs
      [-.22, .42, -.45], [.22, .42, -.45], // rear legs
    ];
    legPositions.forEach((p, i) => {
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(...p); leg.userData.leg = i;
      grp.add(leg);
    });
    // Hooves
    const hoofGeo = new THREE.BoxGeometry(.14, .12, .16);
    legPositions.forEach(p => {
      const hoof = new THREE.Mesh(hoofGeo, darkMat);
      hoof.position.set(p[0], p[1] - .3, p[2]);
      grp.add(hoof);
    });
    [body, neck, head, earL, earR, mane, tail].forEach(m => { m.castShadow = true; grp.add(m); });
    S.scene.add(grp);
    return mkEnt(type, name || 'Cavalo', grp, {
      layer: 'npc',
      physics: mkPhysics({ enabled: false }),
      controllable: makeControllable('horse'),
    });
  }

  // ---- Bicycle ----
  if (type === 'bicycle') {
    const grp = new THREE.Group();
    const frameMat = mkMat(0x2266cc);
    const darkMat  = mkMat(0x111111);
    // Wheel rims
    const wGeo = new THREE.TorusGeometry(.28, .05, 6, 16);
    const wFront = new THREE.Mesh(wGeo, darkMat);
    const wRear  = new THREE.Mesh(wGeo, darkMat);
    wFront.rotation.y = Math.PI/2; wFront.position.set(0, .28, .55);
    wRear.rotation.y  = Math.PI/2; wRear.position.set(0, .28, -.55);
    wFront.userData.wheel = true; wRear.userData.wheel = true;
    // Frame tubes (simplified as thin boxes)
    const topTube = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .8), frameMat);
    topTube.position.set(0, .65, 0); topTube.rotation.x = -.12;
    const downTube = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .75), frameMat);
    downTube.position.set(0, .45, .25); downTube.rotation.x = .45;
    const seatTube = new THREE.Mesh(new THREE.BoxGeometry(.06, .45, .06), frameMat);
    seatTube.position.set(0, .42, -.18);
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(.18, .05, .28), mkMat(0x222222));
    seat.position.set(0, .72, -.22);
    // Handlebar
    const hbar = new THREE.Mesh(new THREE.BoxGeometry(.5, .05, .1), darkMat);
    hbar.position.set(0, .82, .5); hbar.userData.handlebar = true;
    // Crank / pedals
    const crank = new THREE.Mesh(new THREE.BoxGeometry(.04, .22, .04), darkMat);
    crank.position.set(0, .3, -.18); crank.userData.pedalLeft = true;
    const pedalL = new THREE.Mesh(new THREE.BoxGeometry(.18, .04, .06), darkMat);
    pedalL.position.set(-.12, .18, -.18); pedalL.userData.pedalLeft = true;
    const pedalR = new THREE.Mesh(new THREE.BoxGeometry(.18, .04, .06), darkMat);
    pedalR.position.set(.12, .38, -.18); pedalR.userData.pedalRight = true;
    grp.add(wFront, wRear, topTube, downTube, seatTube, seat, hbar, crank, pedalL, pedalR);
    [topTube, downTube, seatTube].forEach(m => m.castShadow = true);
    S.scene.add(grp);
    return mkEnt(type, name || 'Bicicleta', grp, {
      layer: 'vehicle',
      physics: mkPhysics({ enabled: false }),
      controllable: makeControllable('bicycle'),
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

/**
 * Load (or reload) a GLB model into any controllable entity.
 * Clears the existing mesh children and replaces with GLB scene.
 * Works for humanoid, vehicle, motorcycle, horse, bicycle, helicopter, aircraft.
 */
export function loadControllableGLB(ent, url) {
  return _loadEntGLB(ent, url);
}

// Keep old export name for backward compat
export function _loadHumanoidGLB(ent, url) { return _loadEntGLB(ent, url); }

async function _loadEntGLB(ent, url) {
  try {
    const { scene: model, animMgr } = await loadGLB(url);

    // Clear ALL previous children (placeholder geometry)
    const toRemove = [...ent.mesh.children];
    toRemove.forEach(c => ent.mesh.remove(c));

    // For non-Group mesh (lights, cameras) just return
    if (!ent.mesh.isGroup) { console.warn('[EngineLeo] Cannot replace non-Group mesh'); return; }

    // Auto-scale based on controllable type
    const box3 = new THREE.Box3().setFromObject(model);
    const size = box3.getSize(new THREE.Vector3());
    const type = ent.controllable?.type || ent.type;
    const TARGET_HEIGHTS = {
      humanoid: 1.0, horse: 1.6,
      vehicle: 1.5, motorcycle: 1.1, bicycle: 1.0,
      helicopter: 2.5, aircraft: 2.0,
    };
    const targetH = TARGET_HEIGHTS[type] || 1.8;
    const h = size.y;
    if (h > 0.01) model.scale.setScalar(targetH / h);
    model.position.y = 0; // reset vertical offset

    ent.mesh.add(model);
    ent.animMgr = animMgr;

    if (animMgr) {
      animMgr.currentState = null;
      animMgr._locked = false;
      animMgr.setState('idle');
    }

    console.log(`[EngineLeo] GLB carregado: ${url} — ${animMgr?.clips.length || 0} clips`);
    if (window._onEntAnimLoaded) window._onEntAnimLoaded(ent);
  } catch(err) {
    console.warn('[EngineLeo] GLB falhou:', url, err);
    // Fallback placeholder (only if mesh is empty)
    if (ent.mesh.children.length === 0) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 2),
        new THREE.MeshStandardMaterial({ color: 0x5b8cff, wireframe: true })
      );
      ent.mesh.add(body);
    }
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