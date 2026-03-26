// ================================================================
// controllers/HumanoidController.js
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV         = -9.81;
const LAND_DURATION = 0.2;
// Drag aéreo horizontal: quanto a vel XZ decai por segundo no ar (0=sem decaimento)
const AIR_DRAG     = 2.0;

const STATE = { IDLE:'idle', WALK:'walk', RUN:'run', JUMP:'jump', FALL:'fall', LAND:'land' };

export class HumanoidController {
  onEnter(entity) {
    this._vel          = new THREE.Vector3();
    this._grounded     = false;
    this._wasGrounded  = false;
    this._state        = STATE.IDLE;
    this._jumpConsumed = false;
    this._landTimer    = 0;
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

    // ---- Salvar estado anterior do chão ----
    this._wasGrounded = this._grounded;

    // ---- Intenção de movimento ----
    const fwd = new THREE.Vector3(-Math.sin(S.camYaw), 0, -Math.cos(S.camYaw));
    const rgt = new THREE.Vector3( Math.cos(S.camYaw), 0, -Math.sin(S.camYaw));
    const mv  = new THREE.Vector3();
    if (input.forward)  mv.addScaledVector(fwd,  1);
    if (input.backward) mv.addScaledVector(fwd, -1);
    if (input.left)     mv.addScaledVector(rgt, -1);
    if (input.right)    mv.addScaledVector(rgt,  1);
    const hasInput = mv.length() > .01;
    if (hasInput) mv.normalize();

    const sprinting = input.sprint && this._grounded;
    const speed     = sprinting ? ch.stats.sprint : ch.stats.speed;

    // ---- Velocidade XZ ----
    if (this._grounded) {
      // No chão: aceleração normal para o target
      const accel  = ch.stats.accel;
      const tgtX   = hasInput ? mv.x * speed : 0;
      const tgtZ   = hasInput ? mv.z * speed : 0;
      this._vel.x += (tgtX - this._vel.x) * Math.min(1, accel * dt);
      this._vel.z += (tgtZ - this._vel.z) * Math.min(1, accel * dt);
    } else {
      // Bug 2 fix: no ar, APENAS aplica drag — zero influência de input
      const drag = Math.max(0, 1 - AIR_DRAG * dt);
      this._vel.x *= drag;
      this._vel.z *= drag;
    }

    // ---- Gravidade (Bug 3 fix: physics.step NÃO roda no humanoid — ver entities.js) ----
    this._vel.y += GRAV * dt;

    // ---- Mover ----
    m.position.addScaledVector(this._vel, dt);

    // ---- Colisão com chão ----
    // Bug 9 fix: usar bounding box do Group para encontrar a base real do mesh
    const box = new THREE.Box3().setFromObject(m);
    const base = box.min.y; // ponto mais baixo do mesh no espaço do mundo
    if (base <= 0) {
      m.position.y -= base; // empurra de volta para y=0
      if (this._vel.y < 0) this._vel.y = 0;
      this._grounded = true;
    } else {
      this._grounded = false;
    }

    // ---- Pulo com edge-detect ----
    const jumpDown = input.jump;
    if (jumpDown && !this._jumpConsumed && this._grounded) {
      this._vel.y        = ch.stats.jump;
      this._grounded     = false;
      this._jumpConsumed = true;
    }
    if (!jumpDown) this._jumpConsumed = false;

    // ---- Rotação — apenas no chão e fora do landTimer ----
    if (hasInput && this._grounded && this._landTimer <= 0) {
      const ta = Math.atan2(mv.x, mv.z);
      let df   = ta - m.rotation.y;
      while (df >  Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      m.rotation.y += df * Math.min(1, ch.stats.rotSpd * dt);
    }

    // ---- State machine de animação ----
    this._updateAnimState(dt, entity, hasInput, sprinting);
  }

  _updateAnimState(dt, entity, hasInput, sprinting) {
    const mgr = entity.animMgr;

    // Aterrissagem
    if (!this._wasGrounded && this._grounded && this._state !== STATE.IDLE) {
      this._state     = STATE.LAND;
      this._landTimer = LAND_DURATION;
      if (mgr) { mgr._locked = false; mgr.currentState = null; mgr.setState('land', { once: true }); }
      return;
    }

    // Contador de pouso
    if (this._landTimer > 0) {
      this._landTimer -= dt;
      return;
    }

    // Aéreo
    if (!this._grounded) {
      if (this._vel.y > 0) {
        if (this._state !== STATE.JUMP) {
          this._state = STATE.JUMP;
          if (mgr) { mgr._locked = false; mgr.currentState = null; mgr.setState('jump', { once: true }); }
        }
      } else {
        if (this._state !== STATE.FALL) {
          this._state = STATE.FALL;
          if (mgr) { mgr._locked = false; mgr.currentState = null; mgr.setState('fall'); }
        }
      }
      return;
    }

    // Terrestre
    let nextState = hasInput ? (sprinting ? STATE.RUN : STATE.WALK) : STATE.IDLE;
    if (this._state !== nextState) {
      this._state = nextState;
      if (mgr) { mgr._locked = false; mgr.currentState = null; mgr.setState(nextState); }
    }
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return { yawOffset: S.camYaw, pitchOffset: S.camPitch, distance: ch.stats.camD, heightTarget: ch.stats.camY };
  }

  getVelocity()  { return this._vel; }
  isGrounded()   { return this._grounded; }
  getAnimState() { return this._state; }
}
