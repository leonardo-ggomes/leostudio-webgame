// ================================================================
// controllers/MotorcycleController.js
// Moto: lean ao virar, wheelie em aceleração brusca,
// WASD acelerar/frear/virar, Space freio de mão, Shift turbo.
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV = -9.81;

export class MotorcycleController {
  onEnter(entity) {
    this._vel        = new THREE.Vector3();
    this._speed      = 0;
    this._steer      = 0;
    this._lean       = 0;   // inclinação lateral (visual)
    this._wheelie    = 0;   // inclinação frontal (visual)
    this._grounded   = true;
    this._wasGrounded = true;
    this._prevEnter  = false;
  }

  onExit(entity) {
    entity.mesh.rotation.z = 0;
    entity.mesh.rotation.x = 0;
  }

  update(dt, input, entity) {
    const ch = entity.controllable;
    const st = ch.stats;
    const m  = entity.mesh;
    if (!m) return;

    this._wasGrounded = this._grounded;
    const turbo = input.sprint ? st.turboMult || 1.6 : 1;

    // ---- Throttle / Brake ----
    const throttle = input.forward  ? 1 : 0;
    const brake    = input.backward ? 1 : 0;
    const handBrake = input.jump;

    const targetSpeed = throttle * st.topSpeed * turbo - brake * st.reverseSpeed;
    if (handBrake) {
      this._speed *= Math.max(0, 1 - st.brake * 4 * dt);
    } else {
      this._speed += (targetSpeed - this._speed) * Math.min(1, st.accel * dt);
    }
    this._speed *= (1 - st.drag * dt);
    if (Math.abs(this._speed) < 0.02) this._speed = 0;

    // ---- Steering (tighter at low speed, looser at high) ----
    const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const speedRatio = Math.abs(this._speed) / (st.topSpeed + .001);
    const steerSens  = st.steerMax * (1 - speedRatio * 0.5); // less steer at high speed
    const targetSteer = steerInput * steerSens;
    this._steer += (targetSteer - this._steer) * Math.min(1, st.steerReturn * dt);

    if (Math.abs(this._speed) > 0.1) {
      m.rotation.y -= this._steer * (this._speed / st.topSpeed) * st.turnRate * dt;
    }

    // ---- Lateral lean (visual — proportional to steer * speed) ----
    const targetLean = -this._steer * speedRatio * (st.maxLean || 0.4);
    this._lean += (targetLean - this._lean) * Math.min(1, 8 * dt);
    m.rotation.z = this._lean;

    // ---- Wheelie (visual — nose up on hard acceleration) ----
    const accelFeel = (throttle * turbo) * speedRatio;
    const targetWheelie = accelFeel > 0.7 && this._grounded ? (st.maxWheelie || 0.2) : 0;
    this._wheelie += (targetWheelie - this._wheelie) * Math.min(1, 6 * dt);
    m.rotation.x = -this._wheelie;

    // ---- Move ----
    const heading = new THREE.Vector3(-Math.sin(m.rotation.y), 0, -Math.cos(m.rotation.y));
    this._vel.copy(heading).multiplyScalar(this._speed);
    this._vel.y += GRAV * dt;
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

    // ---- Wheel spin (children tagged userData.wheel) ----
    const wheelRot = this._speed * dt * 0.5;
    m.traverse(c => { if (c.userData.wheel) c.rotation.x += wheelRot; });
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return {
      yawOffset:    entity.mesh.rotation.y + Math.PI,
      pitchOffset:  S.camPitch,
      distance:     ch.stats.camD || 5,
      heightTarget: ch.stats.camY || 1.8,
    };
  }

  getVelocity()  { return this._vel; }
  isGrounded()   { return this._grounded; }
  getAnimState() { return 'sit'; }
  getSpeed()     { return this._speed; }
}
