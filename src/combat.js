// ================================================================
// combat.js — Melee + Weapon system
//
// Melee:  punch hitbox in front of player, knockback + stagger
// Weapon: raycast hitscan (pistol/rifle) + projectile pool (shotgun)
// Aim:    ADS camera shift + crosshair tightening
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';

// ----------------------------------------------------------------
// Health component (added to entities on first hit)
// ----------------------------------------------------------------
const DEFAULT_HP = 100;
export function getOrCreateHealth(ent) {
  if (!ent.health) ent.health = { hp: DEFAULT_HP, maxHp: DEFAULT_HP, dead: false, invulMs: 0 };
  return ent.health;
}

// ----------------------------------------------------------------
// Weapon definitions
// ----------------------------------------------------------------
export const WEAPONS = {
  fist: {
    name: 'Soco', slot: 0, type: 'melee',
    damage: 15, range: 1.4, arc: 0.8,   // arc in radians (cone)
    cooldown: 0.5, knockback: 3,
    animState: 'attack',
  },
  pistol: {
    name: 'Pistola', slot: 1, type: 'hitscan',
    damage: 25, range: 80, spread: 0.02,
    cooldown: 0.35, magazineSize: 12, reloadTime: 1.4,
    projectileColor: 0xffee44,
  },
  rifle: {
    name: 'Rifle', slot: 2, type: 'hitscan',
    damage: 40, range: 200, spread: 0.005,
    cooldown: 0.12, magazineSize: 30, reloadTime: 2.2,
    projectileColor: 0xff8800,
  },
  shotgun: {
    name: 'Espingarda', slot: 3, type: 'projectile',
    damage: 12, pellets: 8, spread: 0.18,
    cooldown: 0.9, magazineSize: 6, reloadTime: 2.5,
    projectileSpeed: 40, projectileLife: 0.5,
    projectileColor: 0xff4400,
  },
};

// ----------------------------------------------------------------
// Combat state per entity
// ----------------------------------------------------------------
function mkCombatState() {
  return {
    weapon:       'fist',        // current weapon key
    ammo:         {},            // { pistol: 12, rifle: 30, ... }
    cooldownLeft: 0,
    reloadLeft:   0,
    isReloading:  false,
    isAiming:     false,
    prevShoot:    false,
    prevAttack:   false,
    prevReload:   false,
  };
}

// ----------------------------------------------------------------
// Projectile pool
// ----------------------------------------------------------------
const _projectiles = [];
const _POOL_SIZE = 64;
const _projGeo = new THREE.SphereGeometry(0.06, 4, 4);

function _getProjectile(color) {
  // Reuse dead projectile or create new
  let p = _projectiles.find(p => !p.alive);
  if (!p) {
    if (_projectiles.length >= _POOL_SIZE) return null;
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(_projGeo, mat);
    mesh.visible = false;
    S.scene.add(mesh);
    p = { mesh, vel: new THREE.Vector3(), life: 0, damage: 0, owner: null, alive: false };
    _projectiles.push(p);
  }
  p.mesh.material.color.set(color);
  p.alive = true;
  p.mesh.visible = true;
  return p;
}

function _killProjectile(p) {
  p.alive = false;
  p.mesh.visible = false;
}

// ----------------------------------------------------------------
// Muzzle flash (simple point light burst)
// ----------------------------------------------------------------
let _muzzleLight = null;
let _muzzleTimer = 0;

function _muzzleFlash(pos) {
  if (!_muzzleLight) {
    _muzzleLight = new THREE.PointLight(0xffaa44, 4, 3);
    S.scene.add(_muzzleLight);
  }
  _muzzleLight.position.copy(pos);
  _muzzleLight.visible = true;
  _muzzleTimer = 0.05;
}

// ----------------------------------------------------------------
// Hit marker (visual feedback)
// ----------------------------------------------------------------
const _hitMarkers = [];
const _hitGeo = new THREE.SphereGeometry(0.08, 4, 4);
const _hitMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

function _spawnHitMarker(pos) {
  const mesh = new THREE.Mesh(_hitGeo, _hitMat.clone());
  mesh.position.copy(pos);
  S.scene.add(mesh);
  _hitMarkers.push({ mesh, life: 0.25 });
}

// ----------------------------------------------------------------
// Raycaster for hitscan
// ----------------------------------------------------------------
const _ray = new THREE.Raycaster();
const _spread = new THREE.Vector3();

function _hitscan(origin, direction, range, spread, exclude) {
  // Apply spread
  _spread.copy(direction);
  _spread.x += (Math.random() - 0.5) * spread * 2;
  _spread.y += (Math.random() - 0.5) * spread * 2;
  _spread.z += (Math.random() - 0.5) * spread * 2;
  _spread.normalize();

  _ray.set(origin, _spread);
  _ray.far = range;

  const meshes = S.entities
    .filter(e => e !== exclude && e.mesh && e.visible)
    .flatMap(e => {
      const arr = [];
      e.mesh.traverse(c => { if (c.isMesh) arr.push(c); });
      return arr.map(m => ({ mesh: m, ent: e }));
    });

  const targets = meshes.map(t => t.mesh);
  const hits = _ray.intersectObjects(targets, false);

  if (!hits.length) return null;

  const hit = hits[0];
  const entHit = meshes.find(t => t.mesh === hit.object)?.ent;
  return { point: hit.point, ent: entHit, distance: hit.distance };
}

// ----------------------------------------------------------------
// Melee — cone hitbox check
// ----------------------------------------------------------------
const _hitboxCenter = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _fwdDir = new THREE.Vector3();

function _meleeHit(attacker, weapon) {
  const m = attacker.mesh;
  _fwdDir.set(-Math.sin(m.rotation.y), 0, -Math.cos(m.rotation.y));

  S.entities.forEach(target => {
    if (target === attacker || !target.mesh || !target.visible) return;

    _hitboxCenter.copy(target.mesh.position);
    _toTarget.subVectors(_hitboxCenter, m.position);
    const dist = _toTarget.length();
    if (dist > weapon.range) return;

    _toTarget.normalize();
    const dot = _fwdDir.dot(_toTarget);
    if (dot < Math.cos(weapon.arc * 0.5)) return; // outside cone

    // Hit!
    const hp = getOrCreateHealth(target);
    if (hp.invulMs > 0 || hp.dead) return;

    hp.hp = Math.max(0, hp.hp - weapon.damage);
    hp.invulMs = 300; // 300ms invulnerability
    if (hp.hp <= 0) hp.dead = true;

    // Knockback
    const kb = _toTarget.clone().multiplyScalar(weapon.knockback);
    if (target._controller?.getVelocity) {
      const v = target._controller.getVelocity();
      v.add(kb);
    } else if (target.physics) {
      target.physics.velocity.add(kb);
    }

    _spawnHitMarker(_hitboxCenter.clone().add(new THREE.Vector3(0, 0.5, 0)));
    console.log(`[Combat] ${attacker.name} hit ${target.name} for ${weapon.damage} (${hp.hp}/${hp.maxHp})`);
  });
}

// ----------------------------------------------------------------
// Main update — called from main loop every frame in preview
// ----------------------------------------------------------------
export function update(dt, entity, input) {
  if (!entity.controllable) return;

  // Init combat state
  if (!entity.combat) entity.combat = mkCombatState();
  const cs = entity.combat;

  // Init ammo
  Object.entries(WEAPONS).forEach(([k, w]) => {
    if (w.type !== 'melee' && cs.ammo[k] === undefined) cs.ammo[k] = w.magazineSize;
  });

  // Tick cooldown
  if (cs.cooldownLeft > 0) cs.cooldownLeft -= dt;
  if (cs.reloadLeft  > 0) {
    cs.reloadLeft -= dt;
    if (cs.reloadLeft <= 0) {
      cs.isReloading = false;
      cs.ammo[cs.weapon] = WEAPONS[cs.weapon]?.magazineSize || 0;
    }
  }

  // Muzzle flash timer
  if (_muzzleTimer > 0) {
    _muzzleTimer -= dt;
    if (_muzzleTimer <= 0 && _muzzleLight) _muzzleLight.visible = false;
  }

  // Hit markers
  for (let i = _hitMarkers.length - 1; i >= 0; i--) {
    const hm = _hitMarkers[i];
    hm.life -= dt;
    hm.mesh.scale.setScalar(1 + (1 - hm.life / 0.25) * 2);
    hm.mesh.material.opacity = hm.life / 0.25;
    if (hm.life <= 0) { S.scene.remove(hm.mesh); _hitMarkers.splice(i, 1); }
  }

  // Projectile pool update
  _projectiles.forEach(p => {
    if (!p.alive) return;
    p.life -= dt;
    if (p.life <= 0) { _killProjectile(p); return; }
    p.mesh.position.addScaledVector(p.vel, dt);

    // Simple hit check
    const box = new THREE.Box3();
    S.entities.forEach(target => {
      if (!p.alive || target === p.owner || !target.mesh || !target.visible) return;
      box.setFromObject(target.mesh);
      if (box.containsPoint(p.mesh.position)) {
        const hp = getOrCreateHealth(target);
        hp.hp = Math.max(0, hp.hp - p.damage);
        if (hp.hp <= 0) hp.dead = true;
        _spawnHitMarker(p.mesh.position.clone());
        _killProjectile(p);
      }
    });
  });

  // ---- Weapon switching ----
  if (input.weapon1) cs.weapon = 'fist';
  if (input.weapon2) cs.weapon = 'pistol';
  if (input.weapon3) cs.weapon = 'rifle';
  // 4 = shotgun (no dedicated key yet, cycled)

  // ---- Aim mode ----
  cs.isAiming = input.aim;

  // ---- Reload ----
  const reloadEdge = input.reload && !cs.prevReload;
  cs.prevReload = input.reload;
  if (reloadEdge && !cs.isReloading) {
    const w = WEAPONS[cs.weapon];
    if (w && w.type !== 'melee' && cs.ammo[cs.weapon] < w.magazineSize) {
      cs.isReloading = true;
      cs.reloadLeft  = w.reloadTime;
    }
  }

  // ---- Attack / Shoot ----
  const shootEdge = input.shoot && !cs.prevShoot;
  cs.prevShoot = input.shoot;

  if (shootEdge && cs.cooldownLeft <= 0 && !cs.isReloading) {
    const w = WEAPONS[cs.weapon];
    if (!w) return;
    cs.cooldownLeft = w.cooldown;

    const m  = entity.mesh;
    const origin = m.position.clone().add(new THREE.Vector3(0, 1.4, 0));

    if (w.type === 'melee') {
      // Soco
      _meleeHit(entity, w);
      entity.animMgr?.setState('attack', { once: true });

    } else if (w.type === 'hitscan') {
      if (cs.ammo[cs.weapon] <= 0) { cs.isReloading = true; cs.reloadLeft = w.reloadTime; return; }
      cs.ammo[cs.weapon]--;

      // Direction: aim mode = camera forward, else entity forward
      let dir;
      if (cs.isAiming) {
        dir = new THREE.Vector3(0, 0, -1).applyQuaternion(S.gCam.quaternion);
      } else {
        dir = new THREE.Vector3(-Math.sin(m.rotation.y), -0.05, -Math.cos(m.rotation.y));
      }

      _muzzleFlash(origin.clone().addScaledVector(dir, 0.5));

      // Hitscan
      const hit = _hitscan(origin, dir, w.range, w.spread, entity);
      if (hit) {
        _spawnHitMarker(hit.point);
        if (hit.ent) {
          const hp = getOrCreateHealth(hit.ent);
          hp.hp = Math.max(0, hp.hp - w.damage);
          if (hp.hp <= 0) hp.dead = true;
          console.log(`[Combat] ${entity.name} shot ${hit.ent.name} for ${w.damage} (${hp.hp}/${hp.maxHp})`);
        }
      }

    } else if (w.type === 'projectile') {
      if (cs.ammo[cs.weapon] <= 0) { cs.isReloading = true; cs.reloadLeft = w.reloadTime; return; }
      cs.ammo[cs.weapon]--;

      let dir;
      if (cs.isAiming) {
        dir = new THREE.Vector3(0, 0, -1).applyQuaternion(S.gCam.quaternion);
      } else {
        dir = new THREE.Vector3(-Math.sin(m.rotation.y), -0.02, -Math.cos(m.rotation.y));
      }

      _muzzleFlash(origin.clone().addScaledVector(dir, 0.5));

      // Spawn pellets
      const pellets = w.pellets || 1;
      for (let i = 0; i < pellets; i++) {
        const proj = _getProjectile(w.projectileColor);
        if (!proj) break;
        proj.mesh.position.copy(origin);
        proj.vel.copy(dir)
          .add(new THREE.Vector3((Math.random()-.5)*w.spread*2, (Math.random()-.5)*w.spread*2, (Math.random()-.5)*w.spread*2))
          .normalize()
          .multiplyScalar(w.projectileSpeed);
        proj.life   = w.projectileLife;
        proj.damage = w.damage;
        proj.owner  = entity;
      }
    }
  }
}

// ----------------------------------------------------------------
// Draw aim overlay on pv-canvas
// ----------------------------------------------------------------
export function drawAimHUD(ctx, w, h, entity) {
  if (!entity?.combat) return;
  const cs = entity.combat;
  const wDef = WEAPONS[cs.weapon];

  // Crosshair — tightens when aiming
  const size   = cs.isAiming ? 6 : 14;
  const gap    = cs.isAiming ? 3 : 8;
  const alpha  = cs.isAiming ? 0.95 : 0.65;
  const col    = cs.cooldownLeft > 0 ? 'rgba(255,100,100,' : 'rgba(255,255,255,';
  const cx = w / 2, cy = h / 2;

  ctx.strokeStyle = col + alpha + ')';
  ctx.lineWidth   = cs.isAiming ? 2 : 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - size - gap, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy);        ctx.lineTo(cx + size + gap, cy);
  ctx.moveTo(cx, cy - size - gap); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap);        ctx.lineTo(cx, cy + size + gap);
  ctx.stroke();

  // Center dot when aiming
  if (cs.isAiming) {
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  }

  // Ammo / weapon HUD (bottom center)
  if (!wDef) return;
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.roundRect(w/2 - 90, h - 40, 180, 30, 5); ctx.fill();
  ctx.fillStyle = 'rgba(220,220,220,.85)'; ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';

  if (wDef.type === 'melee') {
    ctx.fillText(`${wDef.name}  [1] soco`, w/2, h - 20);
  } else if (cs.isReloading) {
    const pct = 1 - cs.reloadLeft / wDef.reloadTime;
    ctx.fillText(`Recarregando... ${(pct*100).toFixed(0)}%`, w/2, h - 20);
  } else {
    const ammo = cs.ammo[cs.weapon] ?? wDef.magazineSize;
    ctx.fillText(`${wDef.name}  ${ammo}/${wDef.magazineSize}  [R] recarregar`, w/2, h - 20);
  }
  ctx.textAlign = 'left';
}

// ----------------------------------------------------------------
// Health bar helper (for HUD)
// ----------------------------------------------------------------
export function drawHealthBar(ctx, w, h, entity) {
  const hp = entity?.health;
  if (!hp) return;

  const barW = 160, barH = 8;
  const x = 14, y = h - 112;
  const pct = hp.hp / hp.maxHp;

  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.roundRect(x - 2, y - 2, barW + 4, barH + 4, 3); ctx.fill();

  const col = pct > 0.5 ? '#3ecf8e' : pct > 0.25 ? '#ffb347' : '#ff5c5c';
  ctx.fillStyle = 'rgba(60,60,60,.6)';
  ctx.roundRect(x, y, barW, barH, 2); ctx.fill();
  ctx.fillStyle = col;
  ctx.roundRect(x, y, barW * pct, barH, 2); ctx.fill();

  ctx.fillStyle = 'rgba(220,220,220,.8)'; ctx.font = '10px monospace';
  ctx.fillText(`HP  ${hp.hp}/${hp.maxHp}`, x, y - 4);
}

// ----------------------------------------------------------------
// Invulnerability tick
// ----------------------------------------------------------------
export function tickHealth(dt) {
  S.entities.forEach(ent => {
    if (!ent.health) return;
    if (ent.health.invulMs > 0) ent.health.invulMs -= dt * 1000;
  });
}
