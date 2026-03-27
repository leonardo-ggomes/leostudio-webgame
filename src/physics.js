// ================================================================
// physics.js — Simple built-in physics simulation
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';

// Bug 5 fix: step roda em play E em preview para que objetos dinâmicos
// normais (cubos com physics) também caiam durante o preview mode.
export function step(dt) {
  // Em play: tudo roda. Em preview: roda para objetos sem controller
  // (o controller do humanoid/vehicle gerencia sua própria física)
  const shouldRun = S.playing || S.pvActive;
  if (!shouldRun || S.paused) return;

  S.entities.forEach(ent => {
    const ph = ent.physics;
    if (!ph?.enabled || ph.type !== 'dynamic') return;
    if (ent.controllable) return; // controller owns this entity's movement
    if (!(ent.mesh instanceof THREE.Mesh || ent.mesh instanceof THREE.Group)) return;
    if (!ent.visible || !ent.mesh.visible) return; // skip hidden entities

    if (ph.gravity) ph.velocity.y += S.GRAV * dt;
    ent.mesh.position.addScaledVector(ph.velocity, dt);

    // Bug 4 fix: usar Box3 para encontrar a base real do objeto
    // (funciona para GLBs aninhados com pivot deslocado)
    const box = new THREE.Box3().setFromObject(ent.mesh);
    const base = box.min.y;

    if (base < 0) {
      // Empurra de volta para y=0 corrigindo pelo offset do pivot
      ent.mesh.position.y -= base;
      ph.velocity.y *= -ph.restitution;
      ph.velocity.x *= Math.max(0, 1 - ph.friction * dt * 6);
      ph.velocity.z *= Math.max(0, 1 - ph.friction * dt * 6);
      if (Math.abs(ph.velocity.y) < 0.08) ph.velocity.y = 0;
      ph.grounded = true;
    } else {
      ph.grounded = false;
    }

    if (ph.angularVel.length() > 0.001) {
      ent.mesh.rotation.x += ph.angularVel.x * dt;
      ent.mesh.rotation.y += ph.angularVel.y * dt;
      ent.mesh.rotation.z += ph.angularVel.z * dt;
      ph.angularVel.multiplyScalar(0.97);
    }
  });
}

export function applyImpulse(ent, forceY) {
  if (!ent?.physics) return;
  ent.physics.velocity.y = forceY;
  ent.physics.angularVel.set(
    (Math.random() - .5) * 3,
    (Math.random() - .5) * 3,
    (Math.random() - .5) * 3,
  );
}

export function snapshotScene() {
  return S.entities.map(e => ({
    id:  e.id,
    pos: e.mesh.position.clone(),
    rot: new THREE.Euler().copy(e.mesh.rotation),
    scl: e.mesh.scale.clone(),
  }));
}

export function restoreSnapshot(snap) {
  snap.forEach(s => {
    const e = S.entities.find(e => e.id === s.id);
    if (!e) return;
    e.mesh.position.copy(s.pos);
    e.mesh.rotation.copy(s.rot);
    e.mesh.scale.copy(s.scl);
  });
}

export function resetVelocities() {
  S.entities.forEach(e => {
    if (e.physics) {
      e.physics.velocity  = new THREE.Vector3();
      e.physics.angularVel = new THREE.Vector3();
    }
  });
}