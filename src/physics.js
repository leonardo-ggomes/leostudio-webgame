// ================================================================
// physics.js — Simple built-in physics simulation
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';

export function step(dt) {
  if (!S.playing || S.paused) return;

  S.entities.forEach(ent => {
    const ph = ent.physics;
    if (!ph?.enabled || ph.type !== 'dynamic') return;
    if (ent.controllable) return; // controller owns this entity's movement
    if (!(ent.mesh instanceof THREE.Mesh || ent.mesh instanceof THREE.Group)) return;

    if (ph.gravity) ph.velocity.y += S.GRAV * dt;
    ent.mesh.position.addScaledVector(ph.velocity, dt);

    // Ground collision (y = 0)
    const box = new THREE.Box3().setFromObject(ent.mesh);
    const hh = (box.max.y - box.min.y) / 2;
    if (ent.mesh.position.y - hh < 0) {
      ent.mesh.position.y = hh;
      ph.velocity.y *= -ph.restitution;
      ph.velocity.x *= (1 - ph.friction * dt * 6);
      ph.velocity.z *= (1 - ph.friction * dt * 6);
      if (Math.abs(ph.velocity.y) < .08) ph.velocity.y = 0;
      ph.grounded = true;
    } else {
      ph.grounded = false;
    }

    if (ph.angularVel.length() > .001) {
      ent.mesh.rotation.x += ph.angularVel.x * dt;
      ent.mesh.rotation.y += ph.angularVel.y * dt;
      ent.mesh.rotation.z += ph.angularVel.z * dt;
      ph.angularVel.multiplyScalar(.97);
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
    id: e.id,
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
      e.physics.velocity = new THREE.Vector3();
      e.physics.angularVel = new THREE.Vector3();
    }
  });
}
