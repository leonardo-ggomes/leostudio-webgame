// ================================================================
// controllers/VehicleController.js — Arcade car com física Ackermann
// ================================================================
import * as THREE from 'three';
import * as S from '../state.js';

const GRAV      = -9.81;
// Distância entre eixos (metros, normalizada para tamanho unitário)
// Quanto maior, menor o raio de curva — ajustado para comportamento realista
const WHEELBASE = 2.5;

export class VehicleController {
  onEnter(entity) {
    this._vel         = new THREE.Vector3();
    this._speed       = 0;
    this._steer       = 0;       // ângulo atual do volante (rad)
    this._grounded    = true;
    this._rollAcc     = 0;       // acúmulo de roll dos pneus (normalizado 0-2π)
  }
  onExit(entity) {}

  update(dt, input, entity) {
    const st = entity.controllable.stats;
    const m  = entity.mesh;
    if (!m) return;

    const sign      = st.forwardSign ?? 1;
    const steerSign = st.steerSign   ?? 1;

    // ---- Speed ----
    const throttle  = input.forward  ? 1 : 0;
    const reversing = input.backward ? 1 : 0;
    const handbrake = input.jump;
    const target    = throttle * st.topSpeed - reversing * (st.reverseSpeed ?? 4);

    const accel = this._speed >= 0
      ? (target >= 0 ? st.accel : st.brake)
      : (target <= 0 ? (st.reverseAccel ?? st.accel * 1.4) : st.brake);

    if (handbrake) {
      this._speed *= Math.max(0, 1 - st.brake * 4 * dt);
    } else {
      this._speed += (target - this._speed) * Math.min(1, accel * dt);
    }
    this._speed *= (1 - st.drag * dt);
    if (Math.abs(this._speed) < 0.02) this._speed = 0;

    // ---- Steering — Ackermann simplificado ----
    // steerMax limita o ângulo máximo de viragem (rad)
    const steerInput   = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * steerSign;
    // Reduz sensibilidade em alta velocidade (understeer natural)
    const speedRatio   = Math.min(1, Math.abs(this._speed) / (st.topSpeed + .001));
    const steerLimit   = st.steerMax * (1 - speedRatio * 0.55);
    const targetSteer  = steerInput * steerLimit;
    this._steer       += (targetSteer - this._steer) * Math.min(1, st.steerReturn * dt);

    // ---- Yaw — fórmula Ackermann: ω = v / L * tan(δ) ----
    // Isso garante que o raio de curva é proporcional ao wheelbase,
    // não à velocidade quadrática (que causava o giro excessivo)
    if (Math.abs(this._speed) > 0.05) {
      const movDir  = this._speed >= 0 ? 1 : -1;
      // Limitar steer a ±0.5 rad para tan() não explodir
      const clampedSteer = Math.max(-0.5, Math.min(0.5, this._steer));
      const yawRate = (this._speed * movDir / WHEELBASE) * Math.tan(clampedSteer);
      m.rotation.y -= yawRate * dt * sign;
    }

    // ---- Move ----
    const heading = new THREE.Vector3(
      -Math.sin(m.rotation.y) * sign,
       0,
      -Math.cos(m.rotation.y) * sign,
    );
    this._vel.copy(heading).multiplyScalar(this._speed);
    this._vel.y += GRAV * dt;
    m.position.addScaledVector(this._vel, dt);

    // ---- Ground ----
    const box = new THREE.Box3().setFromObject(m);
    if (box.min.y <= 0) {
      m.position.y -= box.min.y;
      if (this._vel.y < 0) { this._vel.y = 0; this._grounded = true; }
    } else {
      this._grounded = false;
    }

    // ---- Wheel animation ----
    // Roll: quanto o pneu girou baseado na velocidade e raio estimado do pneu
    const TIRE_RADIUS = 0.32; // metros (raio estimado)
    const rollDelta   = (this._speed * dt) / TIRE_RADIUS; // radianos
    this._rollAcc    += rollDelta * sign;

    m.traverse(c => {
      if (!c.userData.wheelFront && !c.userData.wheel && !c.userData.wheelRear) return;

      // Determinar eixo de roll: pneus do GLB podem estar em qualquer orientação.
      // Tentamos eixo X primeiro (padrão Three.js CylinderGeometry rotacionado em Z).
      // Se o pneu tiver userData.rollAxis definido, usa esse.
      const rollAxis = c.userData.rollAxis || 'x';

      // Reset e aplica roll acumulado (sem overflow)
      const normalizedRoll = this._rollAcc % (Math.PI * 2);
      if (rollAxis === 'z')      c.rotation.z = normalizedRoll;
      else if (rollAxis === 'y') c.rotation.y = normalizedRoll;
      else                       c.rotation.x = normalizedRoll;

      // Steering apenas nos pneus dianteiros — no eixo perpendicular ao roll
      if (c.userData.wheelFront) {
        if (rollAxis === 'z')      c.rotation.y = this._steer * steerSign;
        else if (rollAxis === 'y') c.rotation.z = this._steer * steerSign;
        else                       c.rotation.y = this._steer * steerSign;
      }
    });
  }

  getCameraOffset(entity) {
    const st   = entity.controllable.stats;
    const sign = st.forwardSign ?? 1;
    return {
      yawOffset:    entity.mesh.rotation.y + Math.PI * sign,
      pitchOffset:  S.camPitch,
      distance:     st.camD ?? 7.5,
      heightTarget: st.camY ?? 2.8,
    };
  }

  getVelocity()  { return this._vel; }
  getSpeed()     { return this._speed; }
  getSteer()     { return this._steer; }
  isGrounded()   { return this._grounded; }
  getAnimState() { return 'sit'; }
}