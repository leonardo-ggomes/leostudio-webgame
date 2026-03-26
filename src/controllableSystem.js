// ================================================================
// controllableSystem.js — Manages the active controller + camera
// Handles enter/exit between humanoid ↔ vehicle.
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';
import * as Input from './inputManager.js';
import { HumanoidController } from './controllers/HumanoidController.js';
import { VehicleController  } from './controllers/VehicleController.js';

// Factory
function makeController(type) {
  switch (type) {
    case 'vehicle': return new VehicleController();
    default:        return new HumanoidController();
  }
}

// ---- Default stat blocks ----
export const DEFAULT_STATS = {
  humanoid: {
    speed: 5, sprint: 10, jump: 6, accel: 15, rotSpd: 8, camY: 2.0, camD: 5,
  },
  vehicle: {
    topSpeed: 20, accel: 3, brake: 4, reverseSpeed: 5,
    steerMax: 0.6, steerReturn: 6, turnRate: 2.2, drag: 0.5,
    camY: 2.5, camD: 7,
  },
};

export const DEFAULT_KEYBINDS = {
  forward:     { key:'KeyW',        label:'W',     action:'Frente'        },
  backward:    { key:'KeyS',        label:'S',     action:'Trás'          },
  left:        { key:'KeyA',        label:'A',     action:'Esquerda'      },
  right:       { key:'KeyD',        label:'D',     action:'Direita'       },
  sprint:      { key:'ShiftLeft',   label:'Shift', action:'Correr/Turbo'  },
  jump:        { key:'Space',       label:'Space', action:'Pular/Freio'   },
  crouch:      { key:'ControlLeft', label:'Ctrl',  action:'Agachar'       },
  interact:    { key:'KeyE',        label:'E',     action:'Interagir'     },
  enterVehicle:{ key:'KeyF',        label:'F',     action:'Entrar/Sair'   },
  aim:         { key:'Mouse2',      label:'RMB',   action:'Mirar'         },
  shoot:       { key:'Mouse0',      label:'LMB',   action:'Atirar'        },
  cover:       { key:'KeyQ',        label:'Q',     action:'Cover'         },
  roll:        { key:'KeyC',        label:'C',     action:'Rolar'         },
  reload:      { key:'KeyR',        label:'R',     action:'Recarregar'    },
  weapon1:     { key:'Digit1',      label:'1',     action:'Arma 1'        },
  weapon2:     { key:'Digit2',      label:'2',     action:'Arma 2'        },
  weapon3:     { key:'Digit3',      label:'3',     action:'Arma 3'        },
};

// ---- State ----
let _activeEntity   = null;   // entity currently controlled
let _controller     = null;   // active Controller instance
let _prevEnterDown  = false;  // edge detect for F key

export function getActiveEntity() { return _activeEntity; }
export function getController()   { return _controller; }

/** Switch control to an entity. Pass null to release. */
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
  // Expose controller on entity for HUD and external queries
  entity._controller = _controller;

  // Start idle animation (reset state first so it always fires)
  if (entity.animMgr) {
    entity.animMgr.currentState = null;
    entity.animMgr._locked      = false;
    entity.animMgr.setState('idle');
  }
}

/** Per-frame update — called from main loop */
export function update(dt) {
  if (!_activeEntity || !_controller) return;

  const kb    = _activeEntity.controllable?.keybinds || DEFAULT_KEYBINDS;
  const input = Input.sample(kb);

  _controller.update(dt, input, _activeEntity);
  _updateCamera(dt, input);
  _checkEnterExit(input);

  // Update animations
  _activeEntity.animMgr?.update(dt);
}

// ---- Camera ----
function _updateCamera(dt, input) {
  const cam = S.gCam;
  const ent = _activeEntity;
  if (!ent?.mesh) return;

  const offset = _controller.getCameraOffset(ent);

  const yaw   = offset.yawOffset;
  const pitch = S.camPitch;
  const dist  = offset.distance;
  const hy    = offset.heightTarget;

  const co = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch) * dist,
    hy + Math.sin(pitch) * dist * .5,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  const tgt = ent.mesh.position.clone().add(new THREE.Vector3(0, hy * .5, 0));
  cam.position.lerp(ent.mesh.position.clone().add(co), .12);
  cam.lookAt(tgt);
}

// ---- Enter / Exit vehicle (F key, edge detect) ----
function _checkEnterExit(input) {
  const down = input.enterVehicle;
  if (down && !_prevEnterDown) {
    _tryEnterExit();
  }
  _prevEnterDown = down;
}

function _tryEnterExit() {
  const ent = _activeEntity;
  if (!ent) return;

  // If currently in a vehicle, exit → find nearest humanoid
  if (ent.controllable?.type === 'vehicle') {
    const humanoid = S.entities.find(e => e.controllable?.type === 'humanoid' && e !== ent);
    if (humanoid) {
      // Place humanoid next to vehicle
      humanoid.mesh.position.copy(ent.mesh.position).add(new THREE.Vector3(2, 0, 0));
      possess(humanoid);
    }
    return;
  }

  // Otherwise, try to enter a nearby vehicle
  const pos = ent.mesh.position;
  const nearby = S.entities
    .filter(e => e.controllable?.type === 'vehicle')
    .map(e => ({ e, d: e.mesh.position.distanceTo(pos) }))
    .filter(({ d }) => d < 4)
    .sort((a, b) => a.d - b.d)[0];

  if (nearby) possess(nearby.e);
}

/** Create a default controllable component for an entity */
export function makeControllable(type = 'humanoid') {
  return {
    type,
    keybinds: JSON.parse(JSON.stringify(DEFAULT_KEYBINDS)),
    stats: JSON.parse(JSON.stringify(DEFAULT_STATS[type] || DEFAULT_STATS.humanoid)),
  };
}
