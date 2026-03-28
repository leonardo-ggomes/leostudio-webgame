// ================================================================
// controllableSystem.js — Controller router + camera + enter/exit
//
// CÂMERA ADS — estilo GTA V / Ready or Not:
//   - Hip fire: câmera orbita livremente atrás do personagem
//   - ADS (RMB): câmera trava perto do ombro direito, FOV fecha,
//     o mouse continua movendo camYaw/camPitch normalmente via o
//     handler de mousemove do main.js — não há conflito.
//
// O raycast de mira (combat.js › _getAimWorldPoint) parte do centro
// exato da tela usando S.gCam, que já aponta para onde o mouse está.
// Isso é o comportamento correto de RoN / GTA V / Escape from Tarkov.
//
// NOTA: NÃO chame consumeMouseDelta() aqui. O main.js já possui o
// handler canônico de mousemove que atualiza S.camYaw / S.camPitch.
// Ter dois consumidores causaria o bug de câmera travada que foi
// reportado anteriormente.
// ================================================================
import * as THREE from 'three';
import * as S from './state.js';
import * as Input from './inputManager.js';
import { HumanoidController    } from './controllers/HumanoidController.js';
import { VehicleController     } from './controllers/VehicleController.js';
import { HelicopterController  } from './controllers/HelicopterController.js';
import { AircraftController    } from './controllers/AircraftController.js';
import { MotorcycleController  } from './controllers/MotorcycleController.js';
import { HorseController       } from './controllers/HorseController.js';
import { BicycleController     } from './controllers/BicycleController.js';
import * as Combat from './combat.js';

function makeController(type) {
  switch (type) {
    case 'vehicle':     return new VehicleController();
    case 'helicopter':  return new HelicopterController();
    case 'aircraft':    return new AircraftController();
    case 'motorcycle':  return new MotorcycleController();
    case 'horse':       return new HorseController();
    case 'bicycle':     return new BicycleController();
    default:            return new HumanoidController();
  }
}

// ----------------------------------------------------------------
// Camera templates
// ----------------------------------------------------------------
export const CAM_TEMPLATES = {
  'GTA V':         { camD: 5.5, camY: 1.8,  camPitchBase: -0.18, camLerp: 0.10, camFOV: 65 },
  'RDR2':          { camD: 6.5, camY: 2.2,  camPitchBase: -0.22, camLerp: 0.08, camFOV: 60 },
  'Zelda BOTW':    { camD: 8.0, camY: 3.5,  camPitchBase: -0.38, camLerp: 0.10, camFOV: 70 },
  'Souls / DS':    { camD: 4.5, camY: 1.5,  camPitchBase: -0.15, camLerp: 0.14, camFOV: 60 },
  'Over-shoulder': { camD: 3.0, camY: 1.2,  camPitchBase: -0.08, camLerp: 0.16, camFOV: 65 },
  'Top-down':      { camD: 12,  camY: 10,   camPitchBase: -0.85, camLerp: 0.08, camFOV: 50 },
  'Vehicle':       { camD: 7.5, camY: 2.8,  camPitchBase: -0.20, camLerp: 0.10, camFOV: 70 },
  'Aéreo':         { camD: 12,  camY: 5,    camPitchBase: -0.25, camLerp: 0.08, camFOV: 75 },
  'Custom':        { camD: 5,   camY: 2.0,  camPitchBase: -0.20, camLerp: 0.10, camFOV: 65 },
};

export let activeCamSettings = { ...CAM_TEMPLATES['GTA V'] };
export function setCamSettings(s) { Object.assign(activeCamSettings, s); }
export function applyTemplate(name) {
  const t = CAM_TEMPLATES[name];
  if (t) Object.assign(activeCamSettings, t);
}

// ---- Default stats ----
export const DEFAULT_STATS = {
  humanoid: {
    speed: 5, sprint: 10, jump: 6, accel: 15, rotSpd: 8, camY: 2.0, camD: 5,
  },
  vehicle: {
    topSpeed: 20, reverseSpeed: 4, accel: 3, reverseAccel: 5, brake: 4,
    steerMax: 0.6, steerReturn: 6, turnRate: 2.2, drag: 0.5,
    forwardSign: 1, steerSign: 1,
    camY: 2.8, camD: 7.5,
  },
  helicopter: {
    speed: 12, accel: 4, drag: 2.5,
    liftSpeed: 6, yawSpeed: 1.5, turboMult: 1.8,
    rotorRPM: 18, camY: 5, camD: 12,
  },
  aircraft: {
    thrust: 30, topSpeed: 60, drag: 0.3,
    stallSpeed: 8, liftForce: 12,
    pitchRate: 1.2, rollRate: 1.5, yawRate: 0.8,
    brakeForce: 3, camY: 3, camD: 12,
  },
  motorcycle: {
    topSpeed: 28, accel: 4, brake: 5, reverseSpeed: 0, reverseAccel: 0,
    steerMax: 0.7, steerReturn: 7, turnRate: 2.5, drag: 0.4,
    turboMult: 1.6, maxLean: 0.4, maxWheelie: 0.2,
    forwardSign: 1, steerSign: 1,
    camY: 1.8, camD: 5,
  },
  horse: {
    trotSpeed: 7, gallopSpeed: 14, accel: 4, decel: 3,
    steerMax: 1.4, turnRate: 1.6, jumpForce: 7,
    camY: 2.2, camD: 6,
  },
  bicycle: {
    topSpeed: 9, accel: 2.5, brake: 4, drag: 0.6,
    steerMax: 0.9, steerReturn: 6, turnRate: 1.8,
    maxLean: 0.3, camY: 1.6, camD: 4,
  },
};

export const DEFAULT_KEYBINDS = {
  forward:      { key:'KeyW',        label:'W',     action:'Frente / Pitch ↑'        },
  backward:     { key:'KeyS',        label:'S',     action:'Trás / Pitch ↓'          },
  left:         { key:'KeyA',        label:'A',     action:'Esquerda / Roll L'        },
  right:        { key:'KeyD',        label:'D',     action:'Direita / Roll R'         },
  sprint:       { key:'ShiftLeft',   label:'Shift', action:'Correr / Turbo / Throttle'},
  jump:         { key:'Space',       label:'Space', action:'Pular / Subir / Freio mão'},
  crouch:       { key:'ControlLeft', label:'Ctrl',  action:'Agachar / Descer'         },
  interact:     { key:'KeyE',        label:'E',     action:'Interagir'                },
  enterVehicle: { key:'KeyF',        label:'F',     action:'Entrar/Sair Veículo'      },
  aim:          { key:'Mouse2',      label:'RMB',   action:'Mirar (ADS)'              },
  shoot:        { key:'Mouse0',      label:'LMB',   action:'Atirar'                   },
  cover:        { key:'KeyQ',        label:'Q',     action:'Cover / Yaw Esq.'         },
  roll:         { key:'KeyC',        label:'C',     action:'Rolar / Yaw Dir.'         },
  reload:       { key:'KeyR',        label:'R',     action:'Recarregar'               },
  cycleTarget:  { key:'KeyT',        label:'T',     action:'Alternar Câmera'          },
  weapon1:      { key:'Digit1',      label:'1',     action:'Arma 1'                   },
  weapon2:      { key:'Digit2',      label:'2',     action:'Arma 2'                   },
  weapon3:      { key:'Digit3',      label:'3',     action:'Arma 3'                   },
};

// ---- State ----
let _activeEntity = null;
let _controller   = null;
let _prevEnter    = false;
let _prevCycle    = false;

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

  const tmpl = type === 'humanoid'   ? 'GTA V'
             : type === 'helicopter' ? 'Aéreo'
             : type === 'aircraft'   ? 'Aéreo'
             : 'Vehicle';
  applyTemplate(tmpl);

  if (entity.animMgr) {
    entity.animMgr.currentState = null;
    entity.animMgr._locked = false;
    entity.animMgr.setState('idle');
  }
}

// ----------------------------------------------------------------
// Per-frame update
// ----------------------------------------------------------------
export function update(dt) {
  if (!_activeEntity || !_controller) return;

  const kb    = _activeEntity.controllable?.keybinds || DEFAULT_KEYBINDS;
  const input = Input.sample(kb);

  _controller.update(dt, input, _activeEntity);
  _updateCamera(dt, input);
  _checkEnterExit(input);
  _checkCycleTarget(input);

  if (_activeEntity.controllable?.type === 'humanoid') {
    Combat.update(dt, _activeEntity, input);
  }

  _activeEntity.animMgr?.update(dt);
}

// ----------------------------------------------------------------
// Câmera — Hip fire orbita, ADS trava no ombro
// ----------------------------------------------------------------

// Constantes do ADS — ajuste aqui para tunar o feel
const ADS_SHOULDER_X   =  0.45;  // deslocamento lateral para direita (m)
const ADS_SHOULDER_Z   = -0.15;  // levemente para frente da câmera
const ADS_HEIGHT_MULT  =  0.96;  // câmera desce um pouco no ADS
const ADS_DIST_MULT    =  0.40;  // câmera fica muito mais próxima
const ADS_FOV_DELTA    = -15;    // FOV fecha 15° no ADS (65→50)
const ADS_LERP_SPEED   =  12;    // velocidade de transição câmera→ADS

// Posição suavizada da câmera no ADS (evita pop)
const _camPosSmooth = new THREE.Vector3();
let   _camInitialized = false;

function _updateCamera(dt, input) {
  const cam = S.gCam;
  const ent = _activeEntity;
  if (!ent?.mesh) return;

  const cs       = activeCamSettings;
  const entStats = ent.controllable?.stats;

  // ADS lerp do sistema de combate (0 = hip, 1 = ADS)
  const adsMod = Combat.getADSCameraModifier(ent);
  const ads    = adsMod.ads ?? 0;  // valor suavizado 0→1

  const baseDist = entStats?.camD ?? cs.camD;
  const baseY    = entStats?.camY ?? cs.camY;

  const offset   = _controller.getCameraOffset(ent);
  const yaw      = offset.yawOffset;                         // S.camYaw
  const pitch    = S.camPitch + (cs.camPitchBase || -0.2);
  const cPitch   = Math.max(-1.4, Math.min(0.6, pitch));

  // ---- Posição hip fire ----
  // Câmera atrás e acima do personagem, pitch livre
  const hipDist   = baseDist;
  const hipHeight = baseY;
  const hipPos = new THREE.Vector3(
    ent.mesh.position.x + Math.sin(yaw) * Math.cos(cPitch) * hipDist,
    ent.mesh.position.y + hipHeight - Math.sin(cPitch) * hipDist * 0.4,
    ent.mesh.position.z + Math.cos(yaw) * Math.cos(cPitch) * hipDist,
  );

  // ---- Posição ADS (ombro direito, câmera próxima) ----
  // Direção da câmera a partir do yaw atual
  const camFwd   = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const camRight = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));

  // Base: atrás do personagem bem próximo (distância reduzida)
  const adsDist   = baseDist * ADS_DIST_MULT;
  const adsHeight = baseY * ADS_HEIGHT_MULT;

  const adsPos = new THREE.Vector3(
    ent.mesh.position.x + Math.sin(yaw) * Math.cos(cPitch) * adsDist,
    ent.mesh.position.y + adsHeight - Math.sin(cPitch) * adsDist * 0.4,
    ent.mesh.position.z + Math.cos(yaw) * Math.cos(cPitch) * adsDist,
  );

  // Desloca para o ombro direito (perpendicular ao yaw, no espaço da câmera)
  adsPos.addScaledVector(camRight, ADS_SHOULDER_X);
  adsPos.addScaledVector(camFwd,   ADS_SHOULDER_Z);

  // ---- Interpolação suave hip ↔ ADS ----
  if (!_camInitialized) { _camPosSmooth.copy(hipPos); _camInitialized = true; }
  const targetPos = new THREE.Vector3().lerpVectors(hipPos, adsPos, ads);
  _camPosSmooth.lerp(targetPos, Math.min(1, ADS_LERP_SPEED * dt));

  // ---- Look target ----
  // Sempre o centro da cabeça do personagem — isso garante que o
  // raycast do combat.js (centro da tela) aponte para onde a mira está.
  const lookHeight = new THREE.Vector3(0, baseY * 0.6, 0);
  const lookTarget = ent.mesh.position.clone().add(lookHeight);

  cam.position.copy(_camPosSmooth);
  cam.lookAt(lookTarget);

  // ---- FOV ----
  const hipFOV = cs.camFOV || 65;
  const adsFOV = hipFOV + ADS_FOV_DELTA;
  const targetFOV = hipFOV + (adsFOV - hipFOV) * ads;
  if (Math.abs(cam.fov - targetFOV) > 0.05) {
    cam.fov += (targetFOV - cam.fov) * Math.min(1, ADS_LERP_SPEED * dt);
    cam.updateProjectionMatrix();
  }
}

// ---- Enter / Exit vehicle (F key) ----
let _exitHintCountdown = 0;

function _checkEnterExit(input) {
  const down = input.enterVehicle;
  if (down && !_prevEnter) _tryEnterExit();
  _prevEnter = down;
  if (_exitHintCountdown > 0) {
    _exitHintCountdown -= 0.016;
    window._exitBlocked = _exitHintCountdown > 0;
  }
}

const AERIAL_TYPES  = ['helicopter', 'aircraft'];
const GROUND_TYPES  = ['vehicle', 'motorcycle', 'bicycle', 'horse'];
const VEHICLE_TYPES = [...AERIAL_TYPES, ...GROUND_TYPES];

function _tryEnterExit() {
  const ent  = _activeEntity;
  if (!ent) return;
  const type = ent.controllable?.type;

  if (VEHICLE_TYPES.includes(type)) {
    const humanoid = S.entities.find(e => e.controllable?.type === 'humanoid' && e !== ent);
    if (!humanoid) return;

    if (GROUND_TYPES.includes(type)) {
      const speed = Math.abs(_controller?.getSpeed?.() ?? 0);
      if (speed > 1.0) {
        console.log('[Ctrl] Pare o veículo antes de sair (speed:', speed.toFixed(1), ')');
        _exitHintCountdown = 2.0; window._exitBlocked = true;
        return;
      }
      const right = new THREE.Vector3(
        Math.cos(ent.mesh.rotation.y), 0, -Math.sin(ent.mesh.rotation.y)
      ).multiplyScalar(1.8);
      humanoid.mesh.position.copy(ent.mesh.position).add(right);
      humanoid.mesh.position.y = 0;
      humanoid.mesh.rotation.y = ent.mesh.rotation.y;
    } else {
      const vel = _controller?.getVelocity?.() ?? new THREE.Vector3();
      humanoid.mesh.position.copy(ent.mesh.position);
      humanoid._inheritVel = vel.clone();
    }

    humanoid.mesh.visible = true;
    humanoid.visible = true;
    possess(humanoid);

    if (humanoid._inheritVel) {
      const ctrl = humanoid._controller;
      if (ctrl?.getVelocity) ctrl.getVelocity().copy(humanoid._inheritVel);
      humanoid._inheritVel = null;
    }
    return;
  }

  const pos = ent.mesh.position;
  const candidates = S.entities
    .filter(e => VEHICLE_TYPES.includes(e.controllable?.type))
    .map(e => ({ e, d: e.mesh.position.distanceTo(pos) }))
    .filter(({ d }) => d < 5)
    .sort((a, b) => a.d - b.d);

  if (!candidates.length) return;
  ent.mesh.visible = false;
  ent.visible = false;
  possess(candidates[0].e);
}

// ---- Cycle target (T key) ----
function _checkCycleTarget(input) {
  const down = input.cycleTarget;
  if (down && !_prevCycle) _cycleTarget();
  _prevCycle = down;
}
function _cycleTarget() {
  const list = S.entities.filter(e => e.controllable);
  if (list.length < 2) return;
  const idx  = list.indexOf(_activeEntity);
  const next = list[(idx + 1) % list.length];
  const prev = _activeEntity;

  if (prev?.controllable?.type === 'humanoid' && VEHICLE_TYPES.includes(next?.controllable?.type)) {
    prev.mesh.visible = false; prev.visible = false;
  }
  if (next?.controllable?.type === 'humanoid' && VEHICLE_TYPES.includes(prev?.controllable?.type)) {
    next.mesh.visible = true; next.visible = true;
  }
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