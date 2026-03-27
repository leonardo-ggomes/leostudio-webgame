// ================================================================
// combat.js — Sistema de combate GTA V
//
// RMB  = entrar modo mira (ADS) — câmera vai para over-shoulder
// LMB  = atirar na direção do centro da tela
// WASD = strafe (move sem girar enquanto mira)
// Projéteis têm animação de trail, gravidade e colisão por raycast
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';

// ----------------------------------------------------------------
// Health
// ----------------------------------------------------------------
const DEFAULT_HP = 100;
export function getOrCreateHealth(ent) {
  if (!ent.health) ent.health = { hp: DEFAULT_HP, maxHp: DEFAULT_HP, dead: false, invulMs: 0 };
  return ent.health;
}

// ----------------------------------------------------------------
// Weapons
// ----------------------------------------------------------------
export const WEAPONS = {
  fist: {
    name: 'Soco', slot: 0, type: 'melee',
    damage: 15, range: 1.4, arc: 0.8, cooldown: 0.5, knockback: 4,
  },
  pistol: {
    name: 'Pistola', slot: 1, type: 'hitscan',
    damage: 25, range: 80, spread: 0.03, spreadADS: 0.006,
    cooldown: 0.35, magazineSize: 12, reloadTime: 1.4,
    muzzleColor: 0xffee44,
  },
  rifle: {
    name: 'Rifle', slot: 2, type: 'hitscan',
    damage: 40, range: 200, spread: 0.018, spreadADS: 0.002,
    cooldown: 0.11, magazineSize: 30, reloadTime: 2.0,
    muzzleColor: 0xff8800,
  },
  shotgun: {
    name: 'Espingarda', slot: 3, type: 'projectile',
    damage: 14, pellets: 7, spread: 0.18, spreadADS: 0.08,
    cooldown: 0.85, magazineSize: 6, reloadTime: 2.4,
    projectileSpeed: 38, projectileLife: 0.55,
    projectileGravity: -4,
    muzzleColor: 0xff6600,
  },
};

// ----------------------------------------------------------------
// Combat state per entity
// ----------------------------------------------------------------
function mkCombatState() {
  return {
    weapon: 'fist', ammo: {},
    cooldownLeft: 0, reloadLeft: 0,
    isReloading: false, isAiming: false,
    prevShoot: false, prevReload: false,
    adsLerp: 0,          // 0=hip fire  1=ADS (interpolado suave)
    spreadMult: 1.0,     // aumenta ao atirar, volta ao repouso
  };
}

// ----------------------------------------------------------------
// ADS camera constants
// ----------------------------------------------------------------
const ADS_SHOULDER = 0.55;  // deslocamento lateral (m) para ombro direito
const ADS_DIST     = 0.45;  // multiplicador de distância da câmera no ADS
const ADS_HEIGHT   = 0.92;
const ADS_LERP     = 9;     // velocidade de transição hip→ADS

export function getADSCameraModifier(entity) {
  const ads = entity.combat?.adsLerp ?? 0;
  return {
    shoulderOffset: ads * ADS_SHOULDER,
    distMult:       1 - ads * (1 - ADS_DIST),
    heightMult:     1 - ads * (1 - ADS_HEIGHT),
    ads,
  };
}

// ----------------------------------------------------------------
// Screen-center raycast — ponto exato para onde a câmera aponta
// ----------------------------------------------------------------
const _screenRay = new THREE.Raycaster();
const _CENTER    = new THREE.Vector2(0, 0);

function _getAimWorldPoint(maxRange) {
  _screenRay.setFromCamera(_CENTER, S.gCam);

  const meshes = [];
  S.entities.forEach(e => {
    if (!e.mesh || !e.visible) return;
    e.mesh.traverse(c => {
      if (c.isMesh && !c.userData._isColHelper) meshes.push({ mesh: c, ent: e });
    });
  });

  const hits = _screenRay.intersectObjects(meshes.map(p => p.mesh), false);
  if (hits.length) return { point: hits[0].point.clone(), ent: meshes.find(p => p.mesh === hits[0].object)?.ent };

  // Miss — projeta na distância máxima
  return { point: _screenRay.ray.at(maxRange, new THREE.Vector3()), ent: null };
}

// ----------------------------------------------------------------
// Hitscan — raio do cano → ponto de mira com spread
// ----------------------------------------------------------------
const _hitRay = new THREE.Raycaster();

function _hitscan(muzzle, aimPoint, range, spread, exclude) {
  const dir = aimPoint.clone().sub(muzzle).normalize();
  dir.x += (Math.random() - .5) * spread * 2;
  dir.y += (Math.random() - .5) * spread * 2;
  dir.z += (Math.random() - .5) * spread * 2;
  dir.normalize();

  _hitRay.set(muzzle, dir);
  _hitRay.far = range;

  const pairs = [];
  S.entities.forEach(e => {
    if (e === exclude || !e.mesh || !e.visible) return;
    e.mesh.traverse(c => { if (c.isMesh && !c.userData._isColHelper) pairs.push({ mesh: c, ent: e }); });
  });

  const hits = _hitRay.intersectObjects(pairs.map(p => p.mesh), false);
  if (!hits.length) return { point: muzzle.clone().addScaledVector(dir, range), ent: null };

  return { point: hits[0].point.clone(), ent: pairs.find(p => p.mesh === hits[0].object)?.ent };
}

// ----------------------------------------------------------------
// Projectile pool — com trail visual e física
// ----------------------------------------------------------------
const _pool = [];
const POOL_MAX = 128;

// Geometria do trail: cone que se alonga na direção do movimento
const _trailGeo = new THREE.CylinderGeometry(0.015, 0.04, 0.35, 6, 1);
_trailGeo.rotateX(Math.PI / 2); // aponta em Z

function _spawn(color) {
  let p = _pool.find(p => !p.alive);
  if (!p) {
    if (_pool.length >= POOL_MAX) return null;
    const mat  = new THREE.MeshBasicMaterial({ color, transparent: true });
    const body = new THREE.Mesh(_trailGeo, mat);
    body.visible = false;
    S.scene.add(body);

    // Ponto de impacto (esfera pequena)
    const impMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    const impMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), impMat);
    impMesh.visible = false;
    S.scene.add(impMesh);

    p = { body, impMesh, vel: new THREE.Vector3(),
          life: 0, maxLife: 1, damage: 0, gravity: 0,
          owner: null, alive: false, hit: false, hitTimer: 0 };
    _pool.push(p);
  }
  p.body.material.color.set(color);
  p.body.material.opacity = 1;
  return p;
}

function _fireProjectile({ pos, dir, speed, life, damage, gravity, color, owner }) {
  const p = _spawn(color);
  if (!p) return;
  p.body.position.copy(pos);
  p.vel.copy(dir).multiplyScalar(speed);
  p.life = p.maxLife = life;
  p.damage = damage;
  p.gravity = gravity ?? 0;
  p.owner = owner;
  p.alive = true;
  p.hit = false;
  p.hitTimer = 0;
  p.body.visible = true;
  p.impMesh.visible = false;
}

const _projRay = new THREE.Raycaster();
function _updateProjectiles(dt) {
  _pool.forEach(p => {
    if (!p.alive) return;

    // Fase de impacto — mostra flash e some
    if (p.hit) {
      p.hitTimer -= dt;
      const a = Math.max(0, p.hitTimer / 0.12);
      p.impMesh.material.opacity = a;
      p.impMesh.scale.setScalar(1 + (1 - a) * 3);
      if (p.hitTimer <= 0) {
        p.alive = false;
        p.body.visible = false;
        p.impMesh.visible = false;
      }
      return;
    }

    p.life -= dt;
    if (p.life <= 0) { p.alive = false; p.body.visible = false; return; }

    // Fade out no final da vida
    p.body.material.opacity = Math.min(1, p.life / p.maxLife * 3);

    const prev = p.body.position.clone();

    // Física
    p.vel.y += p.gravity * dt;
    p.body.position.addScaledVector(p.vel, dt);

    // Orientar o trail na direção do movimento
    if (p.vel.lengthSq() > 0.001) {
      p.body.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        p.vel.clone().normalize()
      );
    }

    // Raycast sweepado (prev → pos) para não atravessar paredes finas
    const step = p.body.position.clone().sub(prev);
    const dist = step.length();
    if (dist < 0.001) return;

    _projRay.set(prev, step.normalize());
    _projRay.far = dist + 0.05;

    const pairs = [];
    S.entities.forEach(e => {
      if (e === p.owner || !e.mesh || !e.visible) return;
      e.mesh.traverse(c => { if (c.isMesh && !c.userData._isColHelper) pairs.push({ mesh: c, ent: e }); });
    });

    const hits = _projRay.intersectObjects(pairs.map(q => q.mesh), false);
    if (hits.length) {
      const entHit = pairs.find(q => q.mesh === hits[0].object)?.ent;
      if (entHit) {
        const hp = getOrCreateHealth(entHit);
        if (!hp.dead) {
          hp.hp = Math.max(0, hp.hp - p.damage);
          hp.invulMs = 100;
          if (hp.hp <= 0) hp.dead = true;
        }
      }
      // Mostrar impacto
      p.hit = true;
      p.hitTimer = 0.12;
      p.body.visible = false;
      p.impMesh.position.copy(hits[0].point);
      p.impMesh.scale.setScalar(1);
      p.impMesh.material.opacity = 1;
      p.impMesh.visible = true;
    }
  });
}

// ----------------------------------------------------------------
// Muzzle flash
// ----------------------------------------------------------------
let _muzzleLight = null, _muzzleT = 0;
function _muzzleFlash(pos) {
  if (!_muzzleLight) { _muzzleLight = new THREE.PointLight(0xffaa44, 6, 4); S.scene.add(_muzzleLight); }
  _muzzleLight.position.copy(pos);
  _muzzleLight.visible = true;
  _muzzleT = 0.055;
}

// ----------------------------------------------------------------
// Melee
// ----------------------------------------------------------------
const _mFwd = new THREE.Vector3(), _mTo = new THREE.Vector3();
function _meleeHit(attacker, w) {
  const m = attacker.mesh;
  _mFwd.set(-Math.sin(m.rotation.y), 0, -Math.cos(m.rotation.y));
  S.entities.forEach(t => {
    if (t === attacker || !t.mesh || !t.visible) return;
    _mTo.subVectors(t.mesh.position, m.position);
    if (_mTo.length() > w.range) return;
    if (_mFwd.dot(_mTo.clone().normalize()) < Math.cos(w.arc * 0.5)) return;
    const hp = getOrCreateHealth(t);
    if (hp.invulMs > 0 || hp.dead) return;
    hp.hp = Math.max(0, hp.hp - w.damage);
    hp.invulMs = 300;
    if (hp.hp <= 0) hp.dead = true;
    const kb = _mTo.clone().normalize().multiplyScalar(w.knockback);
    if (t._controller?.getVelocity) t._controller.getVelocity().add(kb);
    else if (t.physics) t.physics.velocity.add(kb);
  });
}

// ----------------------------------------------------------------
// Main update
// ----------------------------------------------------------------
export function update(dt, entity, input) {
  if (!entity.controllable) return;
  if (!entity.combat) entity.combat = mkCombatState();
  const cs = entity.combat;

  // Ammo init
  Object.entries(WEAPONS).forEach(([k, w]) => {
    if (w.type !== 'melee' && cs.ammo[k] === undefined) cs.ammo[k] = w.magazineSize;
  });

  // Cooldowns
  if (cs.cooldownLeft > 0) cs.cooldownLeft -= dt;
  if (cs.muzzleT > 0) { cs.muzzleT -= dt; if (cs.muzzleT <= 0 && _muzzleLight) _muzzleLight.visible = false; }
  if (_muzzleT > 0)   { _muzzleT   -= dt; if (_muzzleT   <= 0 && _muzzleLight) _muzzleLight.visible = false; }
  if (cs.reloadLeft > 0) {
    cs.reloadLeft -= dt;
    if (cs.reloadLeft <= 0) {
      cs.isReloading = false;
      cs.ammo[cs.weapon] = WEAPONS[cs.weapon]?.magazineSize || 0;
    }
  }

  // Spread recupera ao longo do tempo
  cs.spreadMult = Math.max(1, cs.spreadMult - dt * 2);

  // Projectiles
  _updateProjectiles(dt);

  // Weapons
  if (input.weapon1) cs.weapon = 'fist';
  if (input.weapon2) cs.weapon = 'pistol';
  if (input.weapon3) cs.weapon = 'rifle';
  if (input.weapon4) cs.weapon = 'shotgun';

  // ---- AIM — RMB toggle ----
  cs.isAiming = input.aim;
  cs.adsLerp += ((cs.isAiming ? 1 : 0) - cs.adsLerp) * Math.min(1, ADS_LERP * dt);

  // ---- Reload ----
  if (input.reload && !cs.prevReload && !cs.isReloading) {
    const w = WEAPONS[cs.weapon];
    if (w?.type !== 'melee' && (cs.ammo[cs.weapon] ?? 0) < w?.magazineSize) {
      cs.isReloading = true;
      cs.reloadLeft  = w.reloadTime;
    }
  }
  cs.prevReload = input.reload;

  // ---- Shoot ----
  const shootEdge = input.shoot && !cs.prevShoot;
  cs.prevShoot = input.shoot;

  if (shootEdge && cs.cooldownLeft <= 0 && !cs.isReloading) {
    const w = WEAPONS[cs.weapon];
    if (!w) return;
    cs.cooldownLeft = w.cooldown;

    const m   = entity.mesh;
    const fwd = new THREE.Vector3(-Math.sin(m.rotation.y), 0, -Math.cos(m.rotation.y));
    // Muzzle: altura dos ombros, levemente à frente
    const muzzle = m.position.clone()
      .add(new THREE.Vector3(0, 1.45, 0))
      .addScaledVector(fwd, 0.55);

    if (w.type === 'melee') {
      _meleeHit(entity, w);
      entity.animMgr?.setState('attack', { once: true });
      return;
    }

    if (cs.ammo[cs.weapon] <= 0) {
      // Auto-reload
      cs.isReloading = true; cs.reloadLeft = w.reloadTime;
      return;
    }
    cs.ammo[cs.weapon]--;
    cs.spreadMult = Math.min(3, cs.spreadMult + 0.4); // recoil acumula

    const spread = (cs.isAiming ? (w.spreadADS ?? w.spread * 0.3) : w.spread) * cs.spreadMult;

    // Ponto de mira = centro exato da tela (independente de onde câmera está)
    const { point: aimPt, ent: aimEnt } = _getAimWorldPoint(w.range ?? 200);

    // Direção real do tiro = muzzle → aimPt
    const shootDir = aimPt.clone().sub(muzzle).normalize();

    _muzzleFlash(muzzle.clone().addScaledVector(shootDir, 0.3));

    if (w.type === 'hitscan') {
      const { point, ent } = _hitscan(muzzle, aimPt, w.range, spread, entity);

      // Projétil visual de traço (rápido, para feedback visual)
      _fireProjectile({
        pos:     muzzle,
        dir:     shootDir.clone().add(new THREE.Vector3((Math.random()-.5)*spread, (Math.random()-.5)*spread, (Math.random()-.5)*spread)).normalize(),
        speed:   180,   // muito rápido — apenas visual
        life:    Math.max(0.04, point.distanceTo(muzzle) / 180),
        damage:  0,     // dano já calculado no hitscan
        gravity: 0,
        color:   w.muzzleColor ?? 0xffee44,
        owner:   entity,
      });

      // Aplicar dano
      if (ent && ent !== entity) {
        const hp = getOrCreateHealth(ent);
        if (!hp.dead && hp.invulMs <= 0) {
          hp.hp = Math.max(0, hp.hp - w.damage);
          hp.invulMs = 80;
          if (hp.hp <= 0) hp.dead = true;
        }
      }

      // Flash de impacto no ponto
      const fl = _spawn(0xffffff);
      if (fl) {
        fl.alive = true; fl.hit = true; fl.hitTimer = 0.1;
        fl.body.visible = false;
        fl.impMesh.position.copy(point);
        fl.impMesh.scale.setScalar(1);
        fl.impMesh.material.opacity = 1;
        fl.impMesh.visible = true;
      }

    } else if (w.type === 'projectile') {
      // Espingarda — múltiplos pellets físicos com gravidade
      const pellets = w.pellets ?? 1;
      for (let i = 0; i < pellets; i++) {
        const d = shootDir.clone().add(new THREE.Vector3(
          (Math.random()-.5)*spread*2,
          (Math.random()-.5)*spread*2,
          (Math.random()-.5)*spread*2
        )).normalize();
        _fireProjectile({
          pos:     muzzle.clone(),
          dir:     d,
          speed:   w.projectileSpeed ?? 35,
          life:    w.projectileLife  ?? 0.5,
          damage:  w.damage,
          gravity: w.projectileGravity ?? -5,
          color:   w.muzzleColor ?? 0xff6600,
          owner:   entity,
        });
      }
    }
  }
}

// ----------------------------------------------------------------
// HUD — crosshair + ammo (GTA V style)
// ----------------------------------------------------------------
export function drawAimHUD(ctx, w, h, entity) {
  const cs   = entity?.combat;
  const wDef = WEAPONS[cs?.weapon ?? 'fist'];
  const ads  = cs?.adsLerp ?? 0;
  const spr  = cs?.spreadMult ?? 1;

  const cx = w / 2, cy = h / 2;

  // ---- Crosshair ----
  // Hip fire: 4 linhas com gap variável (aumenta com spread/movimento)
  // ADS: lines fecham, ponto central aparece
  const baseGap  = 3 + (1 - ads) * 10 + (spr - 1) * 6;
  const lineLen  = 7  + (1 - ads) * 7;
  const alpha    = 0.65 + ads * 0.3;
  const shooting = cs?.cooldownLeft > 0;
  const col      = shooting ? `rgba(255,140,100,${alpha})` : `rgba(255,255,255,${alpha})`;

  ctx.strokeStyle = col;
  ctx.lineWidth   = 1.5 + ads * 0.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - baseGap - lineLen, cy); ctx.lineTo(cx - baseGap, cy);
  ctx.moveTo(cx + baseGap, cy);           ctx.lineTo(cx + baseGap + lineLen, cy);
  ctx.moveTo(cx, cy - baseGap - lineLen); ctx.lineTo(cx, cy - baseGap);
  ctx.moveTo(cx, cy + baseGap);           ctx.lineTo(cx, cy + baseGap + lineLen);
  ctx.stroke();

  // Ponto central (só ADS)
  if (ads > 0.05) {
    ctx.beginPath(); ctx.arc(cx, cy, 1.8 * ads, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
  }

  // Círculo de spread (feedback visual de recuo)
  if (spr > 1.1) {
    const r = (spr - 1) * 18;
    ctx.strokeStyle = `rgba(255,255,255,${0.15 * (spr - 1)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  // ---- Ammo HUD ----
  if (!wDef || !cs) return;
  const panW = 220, panH = 34;
  const px = cx - panW/2, py = h - 50;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.roundRect(px, py, panW, panH, 6); ctx.fill();
  ctx.textAlign = 'center'; ctx.font = 'bold 12px monospace';

  if (wDef.type === 'melee') {
    ctx.fillStyle = 'rgba(230,230,230,.9)';
    ctx.fillText(`${wDef.name}  [1]`, cx, py + 22);
  } else if (cs.isReloading) {
    const pct  = 1 - cs.reloadLeft / wDef.reloadTime;
    const barW = (panW - 20) * pct;
    ctx.fillStyle = 'rgba(255,179,71,.9)';
    ctx.fillText(`Recarregando... ${(pct*100).toFixed(0)}%`, cx, py + 14);
    ctx.fillStyle = 'rgba(255,179,71,.3)';
    ctx.roundRect(px+10, py+20, panW-20, 6, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,179,71,.9)';
    ctx.roundRect(px+10, py+20, barW, 6, 3); ctx.fill();
  } else {
    const ammo    = cs.ammo[cs.weapon] ?? wDef.magazineSize;
    const maxAmmo = wDef.magazineSize;
    const pct     = ammo / maxAmmo;
    const ammoCol = ammo === 0 ? 'rgba(255,80,80,1)' : pct < 0.3 ? 'rgba(255,179,71,1)' : 'rgba(230,230,230,.9)';
    ctx.fillStyle = ammoCol;
    ctx.fillText(`${wDef.name}`, cx - 50, py + 22);
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '11px monospace';
    ctx.fillText(`${ammo} / ${maxAmmo}`, cx + 55, py + 22);
    // Barra de ammo
    ctx.fillStyle = 'rgba(80,80,80,.5)';
    ctx.roundRect(px+10, py+26, panW-20, 4, 2); ctx.fill();
    ctx.fillStyle = ammoCol;
    ctx.roundRect(px+10, py+26, (panW-20)*pct, 4, 2); ctx.fill();
  }
  ctx.textAlign = 'left';

  // Indicador de arma (teclas)
  ctx.fillStyle = 'rgba(150,150,150,.5)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('[1]Soco  [2]Pistola  [3]Rifle  [R]Reload', cx, py - 4);
  ctx.textAlign = 'left';
}

// ----------------------------------------------------------------
// Health bar
// ----------------------------------------------------------------
export function drawHealthBar(ctx, w, h, entity) {
  const hp = entity?.health; if (!hp) return;
  const bW = 160, bH = 8, x = 14, y = h - 120;
  const pct = hp.hp / hp.maxHp;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.roundRect(x-2,y-2,bW+4,bH+4,3); ctx.fill();
  ctx.fillStyle = 'rgba(40,40,40,.7)'; ctx.roundRect(x,y,bW,bH,2); ctx.fill();
  const col = pct > 0.5 ? '#3ecf8e' : pct > 0.25 ? '#ffb347' : '#ff5c5c';
  ctx.fillStyle = col; ctx.roundRect(x, y, bW * pct, bH, 2); ctx.fill();
  ctx.fillStyle='rgba(200,215,230,.8)'; ctx.font='10px monospace';
  ctx.fillText(`HP  ${hp.hp}/${hp.maxHp}`, x, y-4);
}

// ----------------------------------------------------------------
// Invulnerability
// ----------------------------------------------------------------
export function tickHealth(dt) {
  S.entities.forEach(e => { if (e.health?.invulMs > 0) e.health.invulMs -= dt * 1000; });
}