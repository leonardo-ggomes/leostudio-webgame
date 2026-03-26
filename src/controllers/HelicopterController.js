// ================================================================
// controllers/HelicopterController.js
// Hover, pitch/roll movement, yaw rotation, altitude control.
// WASD = move horizontal, Space = subir, Ctrl = descer,
// Q/E = girar yaw, Shift = turbo.
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

export class HelicopterController {
  onEnter(entity) {
    this._vel       = new THREE.Vector3();
    this._yaw       = entity.mesh.rotation.y;
    this._pitch     = 0;  // visual tilt forward/back
    this._roll      = 0;  // visual tilt left/right
    this._liftSpeed = 0;  // vertical speed
    this._rotorAngle = 0;
  }

  onExit(entity) {
    // Reset visual tilt
    entity.mesh.rotation.x = 0;
    entity.mesh.rotation.z = 0;
  }

  update(dt, input, entity) {
    const ch = entity.controllable;
    const st = ch.stats;
    const m  = entity.mesh;
    if (!m) return;

    const turbo = input.sprint ? st.turboMult || 1.8 : 1;

    // ---- Yaw (Q/E via cover/roll binds) ----
    if (input.cover) this._yaw += st.yawSpeed * dt;
    if (input.roll)  this._yaw -= st.yawSpeed * dt;
    m.rotation.y = this._yaw;

    // ---- Altitude (Space up, Ctrl down) ----
    const liftTarget = input.jump ? st.liftSpeed * turbo : input.crouch ? -st.liftSpeed : 0;
    this._liftSpeed += (liftTarget - this._liftSpeed) * Math.min(1, 6 * dt);

    // ---- Horizontal movement ----
    const fwd = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
    const rgt = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw));
    const mv  = new THREE.Vector3();
    if (input.forward)  mv.addScaledVector(fwd,  1);
    if (input.backward) mv.addScaledVector(fwd, -1);
    if (input.left)     mv.addScaledVector(rgt, -1);
    if (input.right)    mv.addScaledVector(rgt,  1);
    const hasInput = mv.length() > .01;
    if (hasInput) mv.normalize();

    const hSpeed = st.speed * turbo;
    this._vel.x += (mv.x * hSpeed - this._vel.x) * Math.min(1, st.accel * dt);
    this._vel.z += (mv.z * hSpeed - this._vel.z) * Math.min(1, st.accel * dt);
    this._vel.y  = this._liftSpeed;

    // Hover stabilization — dampen when no input
    if (!hasInput) {
      this._vel.x *= Math.max(0, 1 - st.drag * dt);
      this._vel.z *= Math.max(0, 1 - st.drag * dt);
    }

    // Ground floor
    if (m.position.y + this._vel.y * dt < 0) {
      m.position.y = 0;
      this._vel.y = 0;
      this._liftSpeed = 0;
    } else {
      m.position.addScaledVector(this._vel, dt);
    }

    // ---- Visual tilt (pitch/roll) ----
    const tiltAmt = 0.18;
    const tgtPitch = input.forward ? tiltAmt : input.backward ? -tiltAmt : 0;
    const tgtRoll  = input.right  ? -tiltAmt : input.left    ?  tiltAmt : 0;
    this._pitch += (tgtPitch - this._pitch) * Math.min(1, 5 * dt);
    this._roll  += (tgtRoll  - this._roll)  * Math.min(1, 5 * dt);
    m.rotation.x = this._pitch;
    m.rotation.z = this._roll;

    // ---- Rotor spin (find rotor child by userData.rotor) ----
    this._rotorAngle += dt * (st.rotorRPM || 15);
    m.traverse(c => {
      if (c.userData.rotor) c.rotation.y = this._rotorAngle;
    });
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return {
      yawOffset:    this._yaw + Math.PI,
      pitchOffset:  S.camPitch,
      distance:     ch.stats.camD || 10,
      heightTarget: ch.stats.camY || 4,
    };
  }

  getVelocity()   { return this._vel; }
  isGrounded()    { return this._vel.y === 0 && this._liftSpeed === 0; }
  getAnimState()  { return 'fly'; }
}
