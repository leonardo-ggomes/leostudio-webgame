// ================================================================
// controllableSystem.js — Controller router + camera + enter/exit
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';
import * as Input from './inputManager.js';
import { HumanoidController    } from './controllers/HumanoidController.js';
import { VehicleController     } from './controllers/VehicleController.js';
import { HelicopterController  } from './controllers/HelicopterController.js';
import { AircraftController    } from './controllers/AircraftController.js';

// ---- Controller factory ----
function makeController(type) {
  switch (type) {
    case 'vehicle':     return new VehicleController();
    case 'helicopter':  return new HelicopterController();
    case 'aircraft':    return new AircraftController();
    default:            return new HumanoidController();
  }
}

// ---- Default stats per type ----
export const DEFAULT_STATS = {
  humanoid: {
    speed: 5, sprint: 10, jump: 6, accel: 15, rotSpd: 8, camY: 2.0, camD: 5,
  },
  vehicle: {
    topSpeed: 20, accel: 3, brake: 4, reverseSpeed: 5,
    steerMax: 0.6, steerReturn: 6, turnRate: 2.2, drag: 0.5,
    camY: 2.5, camD: 7,
  },
  helicopter: {
    speed: 12, accel: 4, drag: 2.5,
    liftSpeed: 6, yawSpeed: 1.5, turboMult: 1.8,
    rotorRPM: 18, camY: 4, camD: 10,
  },
  aircraft: {
    thrust: 30, topSpeed: 60, drag: 0.3,
    stallSpeed: 8, liftForce: 12,
    pitchRate: 1.2, rollRate: 1.5, yawRate: 0.8,
    brakeForce: 3, camY: 3, camD: 12,
  },
};

export const DEFAULT_KEYBINDS = {
  forward:      { key:'KeyW',        label:'W',     action:'Frente / Pitch ↑'   },
  backward:     { key:'KeyS',        label:'S',     action:'Trás / Pitch ↓'     },
  left:         { key:'KeyA',        label:'A',     action:'Esquerda / Roll L'   },
  right:        { key:'KeyD',        label:'D',     action:'Direita / Roll R'    },
  sprint:       { key:'ShiftLeft',   label:'Shift', action:'Correr / Turbo / Throttle' },
  jump:         { key:'Space',       label:'Space', action:'Pular / Subir / Airbrake' },
  crouch:       { key:'ControlLeft', label:'Ctrl',  action:'Agachar / Descer'   },
  interact:     { key:'KeyE',        label:'E',     action:'Interagir'           },
  enterVehicle: { key:'KeyF',        label:'F',     action:'Entrar/Sair Veículo' },
  aim:          { key:'Mouse2',      label:'RMB',   action:'Mirar'               },
  shoot:        { key:'Mouse0',      label:'LMB',   action:'Atirar'              },
  cover:        { key:'KeyQ',        label:'Q',     action:'Cover / Yaw Esq.'   },
  roll:         { key:'KeyC',        label:'C',     action:'Rolar / Yaw Dir.'   },
  reload:       { key:'KeyR',        label:'R',     action:'Recarregar'          },
  cycleTarget:  { key:'KeyT',        label:'T',     action:'Alternar Câmera'     },
  weapon1:      { key:'Digit1',      label:'1',     action:'Arma 1'              },
  weapon2:      { key:'Digit2',      label:'2',     action:'Arma 2'              },
  weapon3:      { key:'Digit3',      label:'3',     action:'Arma 3'              },
};

// ---- State ----
let _activeEntity  = null;
let _controller    = null;
let _prevEnter     = false;
let _prevCycle     = false;

export function getActiveEntity() { return _activeEntity; }
export function getController()   { return _controller; }

// ---- Possess ----
export function possess(entity) {
  if (_activeEntity && _controller) {
    _controller.onExit(_activeEntity);
    _activeEntity._controller = null;
  }
  _activeEntity = entity;
  if (!entity) { _controller = null; return; }

  const type = entity.controllable?.type || 'humanoid';
  _controller = makeController(type);
  _controller.onEnter(entity);
  entity._controller = _controller;

  if (entity.animMgr) {
    entity.animMgr.currentState = null;
    entity.animMgr._locked = false;
    entity.animMgr.setState('idle');
  }
}

// ---- Per-frame update ----
export function update(dt) {
  if (!_activeEntity || !_controller) return;

  const kb    = _activeEntity.controllable?.keybinds || DEFAULT_KEYBINDS;
  const input = Input.sample(kb);

  _controller.update(dt, input, _activeEntity);
  _updateCamera(dt);
  _checkEnterExit(input);
  _checkCycleTarget(input);

  _activeEntity.animMgr?.update(dt);
}

// ---- Camera ----
function _updateCamera(dt) {
  const cam = S.gCam;
  const ent = _activeEntity;
  if (!ent?.mesh) return;

  const offset = _controller.getCameraOffset(ent);
  const yaw    = offset.yawOffset;
  const pitch  = S.camPitch;
  const dist   = offset.distance;
  const hy     = offset.heightTarget;

  const co = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch) * dist,
    hy + Math.sin(pitch) * dist * .5,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  const tgt = ent.mesh.position.clone().add(new THREE.Vector3(0, hy * .5, 0));
  cam.position.lerp(ent.mesh.position.clone().add(co), .12);
  cam.lookAt(tgt);
}

// ---- Enter / Exit vehicle/aircraft (F key) ----
function _checkEnterExit(input) {
  const down = input.enterVehicle;
  if (down && !_prevEnter) _tryEnterExit();
  _prevEnter = down;
}

const AERIAL_TYPES = ['helicopter', 'aircraft'];
const VEHICLE_TYPES = ['vehicle', 'helicopter', 'aircraft'];

function _tryEnterExit() {
  const ent = _activeEntity;
  if (!ent) return;
  const type = ent.controllable?.type;

  // Currently in a vehicle/aircraft → exit back to humanoid
  if (VEHICLE_TYPES.includes(type)) {
    const humanoid = S.entities.find(e => e.controllable?.type === 'humanoid' && e !== ent);
    if (humanoid) {
      const exitPos = ent.mesh.position.clone().add(new THREE.Vector3(2, 0, 0));
      // Aerial: drop humanoid below current altitude to ground
      if (AERIAL_TYPES.includes(type)) exitPos.y = 0;
      humanoid.mesh.position.copy(exitPos);
      possess(humanoid);
    }
    return;
  }

  // Humanoid → find nearest controllable vehicle/aircraft
  const pos = ent.mesh.position;
  const candidates = S.entities
    .filter(e => VEHICLE_TYPES.includes(e.controllable?.type))
    .map(e => ({ e, d: e.mesh.position.distanceTo(pos) }))
    .filter(({ d }) => d < 5)
    .sort((a, b) => a.d - b.d);

  if (candidates.length) possess(candidates[0].e);
}

// ---- Cycle camera target (T key) ----
function _checkCycleTarget(input) {
  const down = input.cycleTarget;
  if (down && !_prevCycle) _cycleTarget();
  _prevCycle = down;
}

function _cycleTarget() {
  const controllables = S.entities.filter(e => e.controllable);
  if (controllables.length < 2) return;
  const idx = controllables.indexOf(_activeEntity);
  const next = controllables[(idx + 1) % controllables.length];
  possess(next);
}

// ---- Factory ----
export function makeControllable(type = 'humanoid') {
  return {
    type,
    keybinds: JSON.parse(JSON.stringify(DEFAULT_KEYBINDS)),
    stats:    JSON.parse(JSON.stringify(DEFAULT_STATS[type] || DEFAULT_STATS.humanoid)),
  };
}
