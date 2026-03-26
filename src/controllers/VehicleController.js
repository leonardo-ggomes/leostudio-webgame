// ================================================================
// controllers/VehicleController.js
// Arcade-style car physics: accelerate, steer, brake, handbrake.
// ================================================================
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

const GRAV = -9.81;

export class VehicleController {
  onEnter(entity) {
    this._vel       = new THREE.Vector3();
    this._speed     = 0;        // signed scalar (fwd positive)
    this._steer     = 0;        // current steer angle
    this._grounded  = false;
    this._wheelsAngle = 0;      // visual wheel turn
  }

  onExit(entity) {
    entity.animMgr?.setState('engine_on');
  }

  update(dt, input, entity) {
    const ch  = entity.controllable;
    const st  = ch.stats;          // { topSpeed, accel, brake, reverseSpeed, steerSpeed, steerReturn, drag, grip, turnRadius }
    const m   = entity.mesh;
    if (!m) return;

    const throttle  = input.forward  ? 1 : 0;
    const reverse   = input.backward ? 1 : 0;
    const braking   = input.jump;        // Space = handbrake
    const steerL    = input.left;
    const steerR    = input.right;

    // ---- Speed ----
    const targetFwd = throttle * st.topSpeed - reverse * st.reverseSpeed;
    if (braking) {
      this._speed *= Math.max(0, 1 - st.brake * 3 * dt);
    } else {
      this._speed += (targetFwd - this._speed) * Math.min(1, st.accel * dt);
    }
    // Drag
    this._speed *= (1 - st.drag * dt);
    if (Math.abs(this._speed) < 0.01) this._speed = 0;

    // ---- Steering ----
    const steerInput = (steerR ? 1 : 0) - (steerL ? 1 : 0);
    const steerFactor = 1 - Math.abs(this._speed) / (st.topSpeed * 1.5 + .001); // less steer at high speed
    const targetSteer = steerInput * st.steerMax * Math.max(.2, steerFactor);
    this._steer += (targetSteer - this._steer) * Math.min(1, st.steerReturn * dt);

    // ---- Rotation (yaw) ----
    if (Math.abs(this._speed) > 0.1) {
      const turnRate = (this._speed / st.topSpeed) * this._steer * st.turnRate;
      m.rotation.y -= turnRate * dt;
    }

    // ---- Move ----
    const heading = new THREE.Vector3(
      -Math.sin(m.rotation.y),
      0,
      -Math.cos(m.rotation.y)
    );
    this._vel.copy(heading).multiplyScalar(this._speed);
    this._vel.y += GRAV * dt;

    m.position.addScaledVector(this._vel, dt);

    // Ground
    if (m.position.y < 0) {
      m.position.y = 0;
      if (this._vel.y < 0) { this._vel.y = 0; this._grounded = true; }
    } else {
      this._grounded = this._vel.y === 0 && m.position.y < .05;
    }

    // ---- Animate wheel turn (visual, if mesh has wheel children tagged) ----
    this._wheelsAngle = this._steer;
    entity.mesh.traverse(c => {
      if (c.userData.wheelFront) c.rotation.y = this._wheelsAngle;
    });

    // ---- Animation (engine idle, etc.) ----
    entity.animMgr?.setState('engine_on');
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return {
      yawOffset:    entity.mesh.rotation.y + Math.PI, // behind vehicle
      pitchOffset:  -0.2,
      distance:     ch.stats.camD || 7,
      heightTarget: ch.stats.camY || 2.5,
    };
  }

  getSpeed()    { return this._speed; }
  getSteer()    { return this._steer; }
  isGrounded()  { return this._grounded; }
}
