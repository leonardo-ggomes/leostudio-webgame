// ================================================================
// controllers/HumanoidController.js
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV = -9.81;

// Estados de movimento — máquina de estados explícita
const STATE = {
  IDLE:    'idle',
  WALK:    'walk',
  RUN:     'run',
  JUMP:    'jump',   // fase ascendente
  FALL:    'fall',   // fase descendente / no ar sem ter pulado
  LAND:    'land',   // frame de pouso (breve, antes de voltar ao idle/walk)
};

// Quanto tempo (s) o personagem fica no estado LAND antes de voltar
const LAND_DURATION = 0.2;

// Controle aéreo reduzido: 0 = sem controle, 1 = controle total
const AIR_CONTROL = 0.15;

export class HumanoidController {
  onEnter(entity) {
    this._vel          = new THREE.Vector3();
    this._grounded     = false;
    this._state        = STATE.IDLE;
    this._jumpConsumed = false;  // impede re-pulo ao segurar Space
    this._landTimer    = 0;      // tempo restante no estado LAND
    this._wasGrounded  = false;
  }

  onExit(entity) {
    entity.animMgr?.setState('idle');
  }

  update(dt, input, entity) {
    const ch = entity.controllable;
    const m  = entity.mesh;
    if (!m) return;

    // ---- Determina se está em estado aéreo ----
    const airborne = !this._grounded;

    // ---- Intenção de movimento (sempre calculada) ----
    const fwd = new THREE.Vector3(-Math.sin(S.camYaw), 0, -Math.cos(S.camYaw));
    const rgt = new THREE.Vector3( Math.cos(S.camYaw), 0, -Math.sin(S.camYaw));
    const mv  = new THREE.Vector3();
    if (input.forward)  mv.addScaledVector(fwd,  1);
    if (input.backward) mv.addScaledVector(fwd, -1);
    if (input.left)     mv.addScaledVector(rgt, -1);
    if (input.right)    mv.addScaledVector(rgt,  1);
    const hasInput = mv.length() > .01;
    if (hasInput) mv.normalize();

    // ---- Sprinting só no chão ----
    const sprinting = input.sprint && this._grounded;
    const speed     = sprinting ? ch.stats.sprint : ch.stats.speed;
    const accel     = ch.stats.accel;

    // ---- Aceleração XZ ----
    // No ar: controle muito reduzido (não zeramos, mas limitamos influência)
    const controlFactor = airborne ? AIR_CONTROL : 1;
    const targetX = hasInput ? mv.x * speed : 0;
    const targetZ = hasInput ? mv.z * speed : 0;
    this._vel.x += (targetX - this._vel.x) * Math.min(1, accel * controlFactor * dt);
    this._vel.z += (targetZ - this._vel.z) * Math.min(1, accel * controlFactor * dt);

    // ---- Gravidade ----
    this._vel.y += GRAV * dt;

    // ---- Move ----
    m.position.addScaledVector(this._vel, dt);

    // ---- Colisão com chão (y=0) ----
    this._wasGrounded = this._grounded;
    if (m.position.y <= 0) {
      m.position.y = 0;
      if (this._vel.y < 0) this._vel.y = 0;
      this._grounded = true;
    } else {
      this._grounded = false;
    }

    // ---- Pulo — edge detect no Space (só dispara ao pressionar, não ao segurar) ----
    const jumpDown = input.jump;
    if (jumpDown && !this._jumpConsumed && this._grounded) {
      this._vel.y      = ch.stats.jump;
      this._grounded   = false;
      this._jumpConsumed = true;
      this._state      = STATE.JUMP;
      entity.animMgr?.setState('jump', { once: true });
    }
    // Libera o pulo assim que soltar a tecla
    if (!jumpDown) this._jumpConsumed = false;

    // ---- Rotação do mesh — bloqueada enquanto airborne ----
    if (hasInput && this._grounded && this._landTimer <= 0) {
      const ta = Math.atan2(mv.x, mv.z);
      let df   = ta - m.rotation.y;
      while (df >  Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      m.rotation.y += df * Math.min(1, ch.stats.rotSpd * dt);
    }

    // ---- Máquina de estados de animação ----
    this._updateAnimState(dt, entity, hasInput, sprinting);
  }

  _updateAnimState(dt, entity, hasInput, sprinting) {
    const mgr = entity.animMgr;

    // ---- Aterrissagem: detecta transição ar → chão ----
    if (!this._wasGrounded && this._grounded && this._state !== STATE.IDLE) {
      this._state     = STATE.LAND;
      this._landTimer = LAND_DURATION;
      mgr?.setState('land', { once: true });
      return;
    }

    // ---- Contador de pouso ----
    if (this._landTimer > 0) {
      this._landTimer -= dt;
      return; // animação de pouso ainda tocando, não interrompe
    }

    // ---- Estados aéreos ----
    if (!this._grounded) {
      if (this._vel.y > 0 && this._state !== STATE.JUMP) {
        this._state = STATE.JUMP;
        mgr?.setState('jump', { once: true });
      } else if (this._vel.y <= 0 && this._state !== STATE.FALL) {
        this._state = STATE.FALL;
        mgr?.setState('fall');
      }
      return; // no ar → não atualiza mais nada
    }

    // ---- Estados terrestres ----
    if (!hasInput) {
      if (this._state !== STATE.IDLE) {
        this._state = STATE.IDLE;
        mgr?.setState('idle');
      }
    } else if (sprinting) {
      if (this._state !== STATE.RUN) {
        this._state = STATE.RUN;
        mgr?.setState('run');
      }
    } else {
      if (this._state !== STATE.WALK) {
        this._state = STATE.WALK;
        mgr?.setState('walk');
      }
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
}