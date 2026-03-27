// ================================================================
// effects.js — Particle system: explosion, blood, sparks, smoke
// Each effect is a pool of instanced particles assigned to entities.
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';

// ---- Particle pool ----
const POOL_SIZE = 512;
const _particles = [];
const _geo  = new THREE.SphereGeometry(1, 4, 4);

// Pre-defined effect presets
export const EFFECTS = {
  explosion: {
    count: 24, speed: [8, 18], life: [0.5, 1.2], size: [0.08, 0.35],
    colors: [0xff6600, 0xff3300, 0xffcc00, 0x444444],
    gravity: -4, drag: 1.8, emitRadius: 0.3,
    fadeOut: true, shrink: true,
  },
  blood: {
    count: 16, speed: [2, 6], life: [0.3, 0.8], size: [0.03, 0.1],
    colors: [0xcc0000, 0x990000, 0xff2200],
    gravity: -12, drag: 1.2, emitRadius: 0.1,
    fadeOut: true, shrink: false,
  },
  sparks: {
    count: 20, speed: [4, 12], life: [0.2, 0.6], size: [0.02, 0.06],
    colors: [0xffff88, 0xffcc44, 0xffffff],
    gravity: -6, drag: 0.8, emitRadius: 0.05,
    fadeOut: true, shrink: true,
  },
  smoke: {
    count: 8, speed: [0.5, 2], life: [1.0, 2.5], size: [0.2, 0.6],
    colors: [0x888888, 0x666666, 0x444444],
    gravity: 1.5, drag: 2.5, emitRadius: 0.2,
    fadeOut: true, shrink: false, grow: true,
  },
  dust: {
    count: 10, speed: [1, 3], life: [0.4, 1.0], size: [0.05, 0.2],
    colors: [0xc8a87a, 0xb89060, 0xa87840],
    gravity: 0.5, drag: 3, emitRadius: 0.3,
    fadeOut: true, shrink: false, grow: true,
  },
  fire: {
    count: 16, speed: [1, 4], life: [0.3, 0.8], size: [0.1, 0.3],
    colors: [0xff4400, 0xff8800, 0xffcc00],
    gravity: 2, drag: 1, emitRadius: 0.15,
    fadeOut: true, shrink: true,
  },
  muzzle: {
    count: 6, speed: [3, 8], life: [0.05, 0.15], size: [0.03, 0.12],
    colors: [0xffee44, 0xffaa22, 0xffffff],
    gravity: 0, drag: 2, emitRadius: 0.02,
    fadeOut: true, shrink: true,
  },
};

function _rnd(min, max) { return min + Math.random() * (max - min); }
function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function _getParticle() {
  let p = _particles.find(p => !p.alive);
  if (!p) {
    if (_particles.length >= POOL_SIZE) {
      // Recycle oldest
      p = _particles.reduce((oldest, cur) => cur.life < oldest.life ? cur : oldest, _particles[0]);
    } else {
      const mat  = new THREE.MeshBasicMaterial({ transparent: true });
      const mesh = new THREE.Mesh(_geo, mat);
      mesh.visible = false;
      S.scene.add(mesh);
      p = { mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1,
            size: 0.1, maxSize: 0.1, grow: false, shrink: false,
            gravity: 0, drag: 1, fadeOut: false, alive: false };
      _particles.push(p);
    }
  }
  return p;
}

/** Spawn an effect at a world position */
export function spawn(effectName, position, options = {}) {
  const preset = EFFECTS[effectName];
  if (!preset) { console.warn('[Effects] Unknown effect:', effectName); return; }

  const dir = options.direction || new THREE.Vector3(0, 1, 0);
  const scale = options.scale || 1;
  const count = Math.round((preset.count) * scale);

  for (let i = 0; i < count; i++) {
    const p = _getParticle();

    // Position with emit radius scatter
    const r = preset.emitRadius * scale;
    p.mesh.position.set(
      position.x + (Math.random()-.5)*r*2,
      position.y + (Math.random()-.5)*r*2,
      position.z + (Math.random()-.5)*r*2,
    );

    // Velocity: spread around direction
    const speed = _rnd(...preset.speed) * scale;
    p.vel.set(
      dir.x + (Math.random()-.5)*2,
      dir.y + (Math.random()-.5)*2,
      dir.z + (Math.random()-.5)*2,
    ).normalize().multiplyScalar(speed);

    // Life & size
    p.maxLife = p.life = _rnd(...preset.life);
    p.size    = p.maxSize = _rnd(...preset.size) * scale;
    p.mesh.scale.setScalar(p.size);

    // Color
    const col = _pick(preset.colors);
    p.mesh.material.color.set(col);
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;

    // Physics params
    p.gravity  = preset.gravity  || 0;
    p.drag     = preset.drag     || 1;
    p.fadeOut  = preset.fadeOut  || false;
    p.shrink   = preset.shrink   || false;
    p.grow     = preset.grow     || false;
    p.alive    = true;
  }
}

/** Attach continuous effect to entity (e.g. fire on vehicle) */
export function attachEffect(entity, effectName, offsetY = 0) {
  if (!entity._effects) entity._effects = [];
  entity._effects.push({ effect: effectName, offsetY, timer: 0, interval: 0.05 });
}
export function detachEffect(entity, effectName) {
  if (!entity._effects) return;
  entity._effects = entity._effects.filter(e => e.effect !== effectName);
}

/** Per-frame update — called from main loop always */
export function update(dt) {
  // Update free particles
  for (const p of _particles) {
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) { p.alive = false; p.mesh.visible = false; continue; }

    const t = p.life / p.maxLife;

    // Physics
    p.vel.y += p.gravity * dt;
    p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.mesh.position.addScaledVector(p.vel, dt);

    // Fade
    if (p.fadeOut) p.mesh.material.opacity = t;

    // Scale
    if (p.shrink)      p.mesh.scale.setScalar(p.size * t);
    else if (p.grow)   p.mesh.scale.setScalar(p.size * (2 - t));
    else               p.mesh.scale.setScalar(p.size);
  }

  // Tick attached effects
  S.entities.forEach(ent => {
    if (!ent._effects?.length) return;
    ent._effects.forEach(fx => {
      fx.timer -= dt;
      if (fx.timer <= 0) {
        fx.timer = fx.interval;
        const pos = ent.mesh.position.clone().add(new THREE.Vector3(0, fx.offsetY, 0));
        spawn(fx.effect, pos);
      }
    });
  });
}

/** Spawn effect on entity hit (called from combat.js) */
export function onHit(entity, pos, isLethal = false) {
  spawn('blood', pos, { scale: isLethal ? 2 : 1 });
}
export function onVehicleHit(entity, pos) {
  spawn('sparks', pos);
  if (entity.health && entity.health.hp < entity.health.maxHp * 0.3) {
    attachEffect(entity, 'smoke', 1);
  }
}
export function onExplosion(pos, scale = 1) {
  spawn('explosion', pos, { scale });
  spawn('smoke',     pos, { scale: scale * 0.8 });
  spawn('sparks',    pos, { scale: scale * 0.5 });
}

/** List all effect names for editor UI */
export const ALL_EFFECTS = Object.keys(EFFECTS);
