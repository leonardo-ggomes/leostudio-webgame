// ================================================================
// controllers/HumanoidController.js — GTA V / Ready or Not style
//
// MIRA:
//   S.mouseAim = false  →  hip fire
//     • câmera orbita livremente pelo mouse
//     • personagem gira só na direção do movimento (WASD)
//     • crosshair NÃO aparece
//
//   S.mouseAim = true   →  ADS (RMB segurado)
//     • câmera trava no ombro direito (controllableSystem)
//     • personagem gira JUNTO com o mouse (corpo segue a mira)
//     • crosshair aparece, LMB atira
//     • strafe: WASD move em relação à direção da câmera, corpo
//       continua apontado para onde o mouse está
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV          = -9.81;
const LAND_DURATION = 0.2;
const AIR_DRAG      = 2.0;
const FALL_MULT     = 2.2;
const LOW_JUMP_MULT = 3.5;

const STATE = { IDLE:'idle', WALK:'walk', RUN:'run', JUMP:'jump', FALL:'fall', LAND:'land' };

export class HumanoidController {
  onEnter(entity) {
    this._vel          = new THREE.Vector3();
    const box          = entity.mesh ? new THREE.Box3().setFromObject(entity.mesh) : null;
    this._grounded     = box ? box.min.y <= 0.2 : false;
    this._wasGrounded  = this._grounded;
    this._state        = this._grounded ? STATE.IDLE : STATE.FALL;
    this._jumpConsumed = false;
    this._landTimer    = 0;
    this._isAiming     = false;
  }

  onExit(entity) {
    if (entity.animMgr) {
      entity.animMgr.currentState = null;
      entity.animMgr.setState('idle');
    }
  }

  update(dt, input, entity) {
    const ch = entity.controllable;
    const m  = entity.mesh;
    if (!m || !ch) return;

    this._wasGrounded = this._grounded;

    // ADS ativado pelo RMB segurado — lido de S.mouseAim
    // que é setado pelo handler de mousemove do main.js.
    this._isAiming = S.mouseAim || input.aim;

    // ---- Direções relativas à câmera ----
    const fwd = new THREE.Vector3(-Math.sin(S.camYaw), 0, -Math.cos(S.camYaw));
    const rgt = new THREE.Vector3( Math.cos(S.camYaw), 0, -Math.sin(S.camYaw));
    const mv  = new THREE.Vector3();
    if (input.forward)  mv.addScaledVector(fwd,  1);
    if (input.backward) mv.addScaledVector(fwd, -1);
    if (input.left)     mv.addScaledVector(rgt, -1);
    if (input.right)    mv.addScaledVector(rgt,  1);
    const hasInput = mv.length() > 0.01;
    if (hasInput) mv.normalize();

    const sprinting = input.sprint && this._grounded && !this._isAiming;
    const speed     = this._isAiming
      ? ch.stats.speed * 0.45
      : sprinting ? ch.stats.sprint : ch.stats.speed;

    // ---- Física horizontal ----
    if (this._grounded) {
      const accel = ch.stats.accel;
      this._vel.x += ((hasInput ? mv.x * speed : 0) - this._vel.x) * Math.min(1, accel * dt);
      this._vel.z += ((hasInput ? mv.z * speed : 0) - this._vel.z) * Math.min(1, accel * dt);
    } else {
      this._vel.x *= Math.max(0, 1 - AIR_DRAG * dt);
      this._vel.z *= Math.max(0, 1 - AIR_DRAG * dt);
    }

    // ---- Gravidade ----
    const gravMult = this._vel.y < 0 ? FALL_MULT
                   : (!input.jump && this._vel.y > 0) ? LOW_JUMP_MULT : 1.0;
    this._vel.y += GRAV * gravMult * dt;
    m.position.addScaledVector(this._vel, dt);

    // ---- Chão ----
    const box = new THREE.Box3().setFromObject(m);
    if (box.min.y <= 0) {
      m.position.y -= box.min.y;
      if (this._vel.y < 0) this._vel.y = 0;
      this._grounded = true;
    } else {
      this._grounded = false;
    }

    // ---- Pulo ----
    if (!this._jumpConsumed && this._grounded && input.jump) {
      this._vel.y        = ch.stats.jump;
      this._grounded     = false;
      this._jumpConsumed = true;
    }
    if (!input.jump) this._jumpConsumed = false;

    // ---- Rotação ----
    if (this._isAiming) {
      // ADS: corpo gira JUNTO com o mouse (S.camYaw atualizado em
      // tempo real pelo mousemove do main.js enquanto RMB pressionado).
      let df = S.camYaw - m.rotation.y;
      while (df >  Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      m.rotation.y += df * Math.min(1, 25 * dt);

    } else if (hasInput && this._grounded && this._landTimer <= 0) {
      // Hip fire: gira apenas na direção do movimento
      const ta = Math.atan2(mv.x, mv.z);
      let df   = ta - m.rotation.y;
      while (df >  Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      m.rotation.y += df * Math.min(1, ch.stats.rotSpd * dt);
    }

    this._updateAnimState(dt, entity, hasInput, sprinting);
  }

  _updateAnimState(dt, entity, hasInput, sprinting) {
    const mgr = entity.animMgr;

    if (!this._wasGrounded && this._grounded && this._state !== STATE.IDLE) {
      this._state     = STATE.LAND;
      this._landTimer = LAND_DURATION;
      if (mgr) { mgr._locked = false; mgr.currentState = null; mgr.setState('land', { once: true }); }
      return;
    }
    if (this._landTimer > 0) { this._landTimer -= dt; return; }

    if (!this._grounded) {
      const next = this._vel.y > 0 ? STATE.JUMP : STATE.FALL;
      if (this._state !== next) {
        this._state = next;
        if (mgr) { mgr._locked = false; mgr.currentState = null; mgr.setState(next, next === STATE.JUMP ? { once: true } : {}); }
      }
      return;
    }

    const next = hasInput ? (sprinting ? STATE.RUN : STATE.WALK) : STATE.IDLE;
    if (this._state !== next) {
      this._state = next;
      if (mgr) { mgr._locked = false; mgr.currentState = null; mgr.setState(next); }
    }
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return {
      yawOffset:    S.camYaw,
      pitchOffset:  S.camPitch,
      distance:     ch.stats.camD,
      heightTarget: ch.stats.camY,
    };
  }

  getVelocity()  { return this._vel; }
  isGrounded()   { return this._grounded; }
  getAnimState() { return this._state; }
  isAiming()     { return this._isAiming; }
}