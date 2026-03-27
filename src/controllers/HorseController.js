// ================================================================
// controllers/HorseController.js
// Cavalo: andadura (passo/trote/galope), pulo, inclinação lateral,
// bob vertical rítmico sincronizado com a velocidade.
// WASD mover, Shift galope, Space pular, A/D virar.
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV = -9.81;

// Gaits por velocidade
const GAITS = [
  { name: 'idle',   maxSpeed: 0.5,  bobAmp: 0,    bobFreq: 0   },
  { name: 'walk',   maxSpeed: 4,    bobAmp: 0.04, bobFreq: 2.5 },
  { name: 'trot',   maxSpeed: 8,    bobAmp: 0.07, bobFreq: 4.5 },
  { name: 'run',    maxSpeed: 14,   bobAmp: 0.12, bobFreq: 7   },
];

export class HorseController {
  onEnter(entity) {
    this._vel       = new THREE.Vector3();
    this._speed     = 0;
    this._steer     = 0;
    this._grounded  = true;
    this._bobPhase  = 0;
    this._bobOffset = 0;
    this._lean      = 0;
    this._jumpConsumed = false;
    this._gait      = 'idle';
  }

  onExit(entity) {
    entity.mesh.rotation.z = 0;
    entity.mesh.rotation.x = 0;
    entity.mesh.position.y = Math.max(0, entity.mesh.position.y);
  }

  update(dt, input, entity) {
    const ch = entity.controllable;
    const st = ch.stats;
    const m  = entity.mesh;
    if (!m) return;

    const galloping = input.sprint && this._grounded;
    const topSpeed  = galloping ? st.gallopSpeed : (input.forward ? st.trotSpeed : 0);

    // ---- Speed ----
    const decel = this._grounded ? st.decel : 1;
    if (input.forward) {
      this._speed += (topSpeed - this._speed) * Math.min(1, st.accel * dt);
    } else {
      this._speed *= Math.max(0, 1 - decel * dt);
    }
    if (Math.abs(this._speed) < 0.05) this._speed = 0;

    // ---- Steering ----
    const steerIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this._steer += (steerIn * (st.steerMax || 1.4) - this._steer) * Math.min(1, 7 * dt);
    if (this._speed > 0.1) {
      const turnFactor = (this._speed / st.gallopSpeed) * st.turnRate;
      m.rotation.y -= this._steer * turnFactor * dt;
    }

    // ---- Lean into turns ----
    const targetLean = -this._steer * (this._speed / st.gallopSpeed) * 0.15;
    this._lean += (targetLean - this._lean) * Math.min(1, 6 * dt);
    m.rotation.z = this._lean;

    // ---- Jump ----
    const jumpDown = input.jump;
    if (jumpDown && !this._jumpConsumed && this._grounded) {
      this._vel.y      = st.jumpForce;
      this._grounded   = false;
      this._jumpConsumed = true;
    }
    if (!jumpDown) this._jumpConsumed = false;

    // ---- Gravity ----
    if (!this._grounded) this._vel.y += GRAV * dt;

    // ---- Move ----
    const fwd = new THREE.Vector3(-Math.sin(m.rotation.y), 0, -Math.cos(m.rotation.y));
    this._vel.x = fwd.x * this._speed;
    this._vel.z = fwd.z * this._speed;
    m.position.addScaledVector(this._vel, dt);

    // ---- Ground ----
    const box = new THREE.Box3().setFromObject(m);
    if (box.min.y <= 0) {
      m.position.y -= box.min.y;
      if (this._vel.y < 0) this._vel.y = 0;
      this._grounded = true;
    } else {
      this._grounded = false;
    }

    // ---- Bob rítmico (simula batida dos cascos) ----
    const gait = GAITS.find(g => this._speed <= g.maxSpeed) || GAITS[GAITS.length - 1];
    this._gait = gait.name;
    if (this._grounded && gait.bobFreq > 0) {
      this._bobPhase += gait.bobFreq * dt;
      this._bobOffset  = Math.sin(this._bobPhase) * gait.bobAmp;
      m.rotation.x     = Math.sin(this._bobPhase) * gait.bobAmp * 0.5; // pitch leve
    } else {
      this._bobOffset  = 0;
      m.rotation.x     = this._grounded ? 0 : -0.05; // nose up no ar
    }

    // ---- Wheel/hoof animate (children tagged userData.leg) ----
    let legIdx = 0;
    m.traverse(c => {
      if (c.userData.leg !== undefined) {
        const phase = this._bobPhase + (legIdx * Math.PI * 0.5);
        c.rotation.x = Math.sin(phase) * (this._speed / st.gallopSpeed) * 0.6;
        legIdx++;
      }
    });
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return {
      yawOffset:    entity.mesh.rotation.y + Math.PI,
      pitchOffset:  S.camPitch,
      distance:     ch.stats.camD || 6,
      heightTarget: ch.stats.camY || 2.2,
    };
  }

  getVelocity()  { return this._vel; }
  isGrounded()   { return this._grounded; }
  getAnimState() { return this._gait; }
  getSpeed()     { return this._speed; }
}
