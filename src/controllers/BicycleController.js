// ================================================================
// controllers/BicycleController.js
// Bicicleta: equilíbrio dependente de velocidade, sem marcha ré,
// pedalada com esforço (desacelera em subidas), lean + steer.
// W acelerar, S frear, A/D virar, Space freio brusco.
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV = -9.81;

export class BicycleController {
  onEnter(entity) {
    this._vel      = new THREE.Vector3();
    this._speed    = 0;
    this._steer    = 0;
    this._lean     = 0;
    this._pedalPhase = 0;
    this._grounded = true;
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

    const pedaling  = input.forward;
    const braking   = input.backward || input.jump;

    // ---- Speed — sem ré, desacelera passivamente por atrito ----
    if (pedaling) {
      this._speed += (st.topSpeed - this._speed) * Math.min(1, st.accel * dt);
    } else if (braking) {
      this._speed *= Math.max(0, 1 - st.brake * (input.jump ? 5 : 2) * dt);
    } else {
      // Rolagem livre com atrito leve
      this._speed *= Math.max(0, 1 - st.drag * dt);
    }
    this._speed = Math.max(0, this._speed); // sem ré
    if (this._speed < 0.02) this._speed = 0;

    // ---- Steering — menos eficiente em alta velocidade ----
    const steerIn    = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const speedRatio = this._speed / (st.topSpeed + .001);
    const steerSens  = st.steerMax * (0.3 + (1 - speedRatio) * 0.7); // mais sensível devagar
    this._steer += (steerIn * steerSens - this._steer) * Math.min(1, st.steerReturn * dt);

    if (this._speed > 0.1) {
      m.rotation.y -= this._steer * speedRatio * st.turnRate * dt;
    }

    // ---- Lean — inclinação de equilíbrio (maior lean = tombando) ----
    // Abaixo de ~1.5 m/s a bicicleta perde equilíbrio (simplificado: apenas visual)
    const balanceFactor = Math.min(1, this._speed / 1.5);
    const targetLean    = -this._steer * speedRatio * (st.maxLean || 0.3);
    this._lean += (targetLean - this._lean) * Math.min(1, 6 * dt);
    // Em baixa velocidade amplifica o lean (instabilidade visual)
    m.rotation.z = this._lean * (1 + (1 - balanceFactor) * 0.5);

    // ---- Gravidade & movimento ----
    if (!this._grounded) this._vel.y += GRAV * dt;
    const heading = new THREE.Vector3(-Math.sin(m.rotation.y), 0, -Math.cos(m.rotation.y));
    this._vel.x = heading.x * this._speed;
    this._vel.z = heading.z * this._speed;
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

    // ---- Pedal animation ----
    if (pedaling && this._grounded) this._pedalPhase += this._speed * dt;
    m.traverse(c => {
      if (c.userData.pedalLeft)  c.rotation.x = this._pedalPhase;
      if (c.userData.pedalRight) c.rotation.x = this._pedalPhase + Math.PI;
      if (c.userData.wheel)      c.rotation.x += this._speed * dt * 0.6;
      if (c.userData.handlebar)  c.rotation.y = this._steer * 0.5;
    });
  }

  getCameraOffset(entity) {
    const ch = entity.controllable;
    return {
      yawOffset:    entity.mesh.rotation.y + Math.PI,
      pitchOffset:  S.camPitch,
      distance:     ch.stats.camD || 4,
      heightTarget: ch.stats.camY || 1.6,
    };
  }

  getVelocity()  { return this._vel; }
  isGrounded()   { return this._grounded; }
  getAnimState() { return this._speed > 0.1 ? 'ride' : 'idle'; }
  getSpeed()     { return this._speed; }
}
