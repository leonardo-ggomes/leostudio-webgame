// ================================================================
// collision.js — AABB broadphase + MTV push-out
// Runs every frame (play AND preview).
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';

const _box1    = new THREE.Box3();
const _box2    = new THREE.Box3();
const _center1 = new THREE.Vector3();
const _center2 = new THREE.Vector3();
const _size1   = new THREE.Vector3();
const _size2   = new THREE.Vector3();
const _push    = new THREE.Vector3();

// ---- Classificação de entidades --------------------------------

// Tipos que sempre bloqueiam movimento (mesmo sem physics ativo)
const ALWAYS_SOLID = new Set([
  'cube','sphere','cylinder','plane','gltf',
]);

// Tipos controlados por controller — NÃO são sólidos entre si,
// mas bloqueiam e são bloqueados por sólidos estáticos.
const CONTROLLED_TYPES = new Set([
  'humanoid','vehicle','motorcycle','bicycle','horse','helicopter','aircraft',
]);

function isSolid(ent) {
  // 1. Física estática explícita
  if (ent.physics?.enabled && ent.physics?.type === 'static') return true;
  // 2. Primitivos sempre sólidos (mesmo sem physics.enabled)
  if (ALWAYS_SOLID.has(ent.type)) return true;
  return false;
}

function isDynamic(ent) {
  // Controller próprio (humanoid, vehicle, etc.)
  if (ent.controllable && CONTROLLED_TYPES.has(ent.type)) return true;
  // Física dinâmica normal
  if (ent.physics?.enabled && ent.physics?.type === 'dynamic') return true;
  return false;
}

function canCollide(ent) {
  if (!ent.mesh) return false;
  // Bug 1 fix: checar mesh.visible além de ent.visible
  // Humanoids ocultos dentro de veículos não devem colidir
  if (!ent.visible || !ent.mesh.visible) return false;
  return isSolid(ent) || isDynamic(ent);
}

// ---- Resolução AABB com MTV -----------------------------------

function resolveAABB(entA, entB, fractionA = 1.0, fractionB = 0.0) {
  _box1.setFromObject(entA.mesh);
  _box2.setFromObject(entB.mesh);

  if (!_box1.intersectsBox(_box2)) return false;

  _box1.getCenter(_center1);
  _box2.getCenter(_center2);
  _box1.getSize(_size1);
  _box2.getSize(_size2);

  const halfSumX = (_size1.x + _size2.x) * 0.5;
  const halfSumY = (_size1.y + _size2.y) * 0.5;
  const halfSumZ = (_size1.z + _size2.z) * 0.5;

  const dX = _center1.x - _center2.x;
  const dY = _center1.y - _center2.y;
  const dZ = _center1.z - _center2.z;

  const overlapX = halfSumX - Math.abs(dX);
  const overlapY = halfSumY - Math.abs(dY);
  const overlapZ = halfSumZ - Math.abs(dZ);

  if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return false;

  // Eixo de menor penetração (MTV)
  _push.set(0, 0, 0);
  if (overlapX <= overlapY && overlapX <= overlapZ) {
    _push.x = overlapX * Math.sign(dX);
  } else if (overlapY <= overlapX && overlapY <= overlapZ) {
    _push.y = overlapY * Math.sign(dY);
  } else {
    _push.z = overlapZ * Math.sign(dZ);
  }

  // Aplicar deslocamento
  if (fractionA > 0) entA.mesh.position.addScaledVector(_push,  fractionA);
  if (fractionB > 0) entB.mesh.position.addScaledVector(_push, -fractionB);

  // Cancelar velocidade do controller no eixo de colisão
  _cancelControllerVel(entA, _push,  1);
  _cancelControllerVel(entB, _push, -1);

  // Notificar scripts
  _fireCollision(entA, entB);
  _fireCollision(entB, entA);

  return true;
}

function _cancelControllerVel(ent, push, sign) {
  const ctrl = ent._controller;
  if (!ctrl?.getVelocity) return;
  const v = ctrl.getVelocity();
  if (!v) return;
  if (push.x !== 0 && Math.sign(v.x) === -Math.sign(push.x * sign)) v.x = 0;
  if (push.z !== 0 && Math.sign(v.z) === -Math.sign(push.z * sign)) v.z = 0;
  // Se empurrado para cima (chão de colisão), parar queda
  if (push.y * sign > 0 && v.y < 0) v.y = 0;
}

function _fireCollision(ent, other) {
  if (!ent._si) return;
  Object.values(ent._si).forEach(inst => {
    try { inst.onCollision?.(other); } catch(e) {}
  });
}

// ---- Loop principal -------------------------------------------

export function step() {
  // Roda sempre — tanto em play quanto em preview
  // Bug 3 fix: inclui primitivos sem physics.enabled via ALWAYS_SOLID
  const ents = S.entities.filter(canCollide);
  const n    = ents.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = ents[i];
      const b = ents[j];

      const aDyn = isDynamic(a);
      const bDyn = isDynamic(b);
      const aSol = isSolid(a);
      const bSol = isSolid(b);

      // Ambos estáticos → skip
      if (!aDyn && !bDyn) continue;

      // Bug 2 fix: dois controllers do mesmo tipo não colidem entre si
      // (humanoid passa por humanoid, veículo por veículo)
      const HUMANOID_SKIP = new Set(['humanoid']);
      if (a.controllable && b.controllable &&
          HUMANOID_SKIP.has(a.controllable.type) &&
          HUMANOID_SKIP.has(b.controllable.type)) continue;

      if (aDyn && bSol && !bDyn) {
        resolveAABB(a, b, 1.0, 0.0);          // A dinâmico, B estático → empurra só A
      } else if (bDyn && aSol && !aDyn) {
        resolveAABB(b, a, 1.0, 0.0);          // B dinâmico, A estático → empurra só B
      } else if (aDyn && bDyn) {
        resolveAABB(a, b, 0.5, 0.5);          // Ambos dinâmicos → divide push
      }
    }
  }
}