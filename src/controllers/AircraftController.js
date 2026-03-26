// ================================================================
// controllers/AircraftController.js
// Fixed-wing aircraft: throttle, lift, stall, pitch, roll, yaw.
// W/S = pitch (nose up/down), A/D = roll+yaw, Shift = throttle,
// Space = airbrake, Q/E = rudder yaw only.
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV = -9.81;

export class AircraftController {
  onEnter(entity) {
    this._vel        = new THREE.Vector3();
    this._throttle   = 0;     // 0..1
    this._pitch      = 0;     // mesh rotation X (nose up = negative)
    this._roll       = 0;     // mesh rotation Z
    this._yaw        = entity.mesh.rotation.y;
    this._speed      = 0;     // forward airspeed scalar
    this._propAngle  = 0;
  }

  onExit(entity) {
    entity.mesh.rotation.x = 0;
    entity.mesh.rotation.z = 0;
  }

  update(dt, input, entity) {
    const ch = entity.controllable;
    const st = ch.stats;
    const m  = entity.mesh;
    if (!m) return;

    // ---- Throttle ----
    const thTarget = input.sprint ? 1 : input.backward ? 0 : this._throttle;
    this._throttle += (thTarget - this._throttle) * Math.min(1, 2 * dt);

    // ---- Airspeed ----
    const thrust = this._throttle * st.thrust;
    this._speed  += (thrust - this._speed * st.drag) * dt;
    this._speed   = Math.max(0, Math.min(st.topSpeed, this._speed));

    // ---- Pitch (W/S) ----
    const pitchRate = st.pitchRate || 1.2;
    if (input.forward)  this._pitch -= pitchRate * dt;
    if (input.backward) this._pitch += pitchRate * dt;
    this._pitch = Math.max(-1.2, Math.min(1.2, this._pitch));
    this._pitch += (0 - this._pitch) * Math.min(1, 0.8 * dt); // auto-level

    // ---- Roll (A/D) ----
    const rollRate = st.rollRate || 1.5;
    if (input.left)  this._roll += rollRate * dt;
    if (input.right) this._roll -= rollRate * dt;
    this._roll = Math.max(-1.1, Math.min(1.1, this._roll));
    this._roll += (0 - this._roll) * Math.min(1, 0.6 * dt); // auto-level

    // ---- Yaw (coupled from roll + Q/E rudder) ----
    const yawRate = st.yawRate || 0.8;
    this._yaw -= this._roll * yawRate * dt;
    if (input.cover) this._yaw += yawRate * 0.5 * dt;
    if (input.roll)  this._yaw -= yawRate * 0.5 * dt;

    // Apply rotations to mesh
    m.rotation.y = this._yaw;
    m.rotation.x = this._pitch;
    m.rotation.z = this._roll;

    // ---- Lift (depends on speed and pitch) ----
    const minLiftSpeed = st.stallSpeed || 8;
    const liftFactor   = Math.max(0, (this._speed - minLiftSpeed) / minLiftSpeed);
    const lift         = liftFactor * st.liftForce - GRAV; // counteracts gravity at cruise

    // ---- Velocity in world space ----
    // Forward direction from yaw+pitch
    const fwdDir = new THREE.Vector3(
      -Math.sin(this._yaw) * Math.cos(this._pitch),
       Math.sin(-this._pitch),
      -Math.cos(this._yaw) * Math.cos(this._pitch)
    ).normalize();

    this._vel.copy(fwdDir).multiplyScalar(this._speed);

    // Add gravity, subtract lift
    this._vel.y += (GRAV + lift) * dt;

    // Airbrake
    if (input.jump) {
      this._speed *= Math.max(0, 1 - (st.brakeForce || 3) * dt);
      this._vel.x *= 0.98; this._vel.z *= 0.98;
    }

    // Move
    m.position.addScaledVector(this._vel, dt);

    // Ground (runway floor)
    if (m.position.y < 0) {
      m.position.y = 0;
      this._vel.y  = 0;
      this._pitch  = 0;
      // Friction on ground
      this._speed *= Math.max(0, 1 - 1.5 * dt);
    }

    // ---- Propeller spin ----
    this._propAngle += this._throttle * dt * 25;
    m.traverse(c => {
      if (c.userData.propeller || c.userData.rotor) c.rotation.z = this._propAngle;
    });
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return {
      yawOffset:    this._yaw + Math.PI,
      pitchOffset:  S.camPitch,
      distance:     ch.stats.camD || 12,
      heightTarget: ch.stats.camY || 3,
    };
  }

  getVelocity()  { return this._vel; }
  isGrounded()   { return this._vel.y === 0 && this._pitch === 0; }
  getAnimState() { return 'fly'; }
  getThrottle()  { return this._throttle; }
  getSpeed()     { return this._speed; }
}
