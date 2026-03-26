// ================================================================
// state.js — Single source of truth for all shared engine state
// ================================================================
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

// --- Scene / Renderer ---
export const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('vp'),
  antialias: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x080910);

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x080910, 0.015);

// --- Cameras ---
export const edCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
edCam.position.set(7, 6, 11);
export const gCam = new THREE.PerspectiveCamera(65, 1, 0.1, 800);
export let activeCam = edCam;
export function setActiveCam(c) { activeCam = c; }

// --- Entities ---
export let entities = [];
export let selEnt = null;
export let nextId = 1;
export function setSelEnt(e) { selEnt = e; }
export function setNextId(n) { nextId = n; }
export function setEntities(arr) { entities = arr; }

// --- Play state ---
export let playing = false;
export let paused = false;
export let playSnap = [];
export function setPlaying(v) { playing = v; }
export function setPaused(v) { paused = v; }
export function setPlaySnap(arr) { playSnap = arr; }

// --- Preview (3rd person) ---
export let pvActive = false;
export let pvChar = null;
export function setPvActive(v) { pvActive = v; }
export function setPvChar(c) { pvChar = c; }

// --- Gizmo ---
export let gizmoMode = 'translate';
export let gizmoSpace = 'world';
export let snap = { grid: false, angle: false };
export function setGizmoMode(m) { gizmoMode = m; }
export function setGizmoSpace(s) { gizmoSpace = s; }

// --- Character runtime ---
export let charVel = new THREE.Vector3();
export let charGrounded = false;
export let camYaw = 0;
export let camPitch = -0.3;
export let mouseAim = false;
export function setCharVel(v) { charVel = v; }
export function setCharGrounded(v) { charGrounded = v; }
export function setCamYaw(v) { camYaw = v; }
export function setCamPitch(v) { camPitch = v; }
export function setMouseAim(v) { mouseAim = v; }

// --- Misc ---
export const GRAV = -9.81;
export const COLS = [0x5b8cff,0x3ecf8e,0xff5c5c,0xffb347,0x9b72ff,0x5bc9c9,0xff7eb3,0xffd700];
export const ICONS = {
  cube:'◻', sphere:'◯', cylinder:'⬬', plane:'▭', character:'⬤',
  'light-point':'◉', 'light-dir':'☀', empty:'⊕', camera:'◎', gltf:'⬡',
};

export const DEF_KB = {
  forward:     { key:'KeyW',       label:'W',     action:'Andar Frente'  },
  backward:    { key:'KeyS',       label:'S',     action:'Andar Trás'    },
  left:        { key:'KeyA',       label:'A',     action:'Esquerda'      },
  right:       { key:'KeyD',       label:'D',     action:'Direita'       },
  sprint:      { key:'ShiftLeft',  label:'Shift', action:'Correr'        },
  jump:        { key:'Space',      label:'Space', action:'Pular'         },
  crouch:      { key:'ControlLeft',label:'Ctrl',  action:'Agachar'       },
  interact:    { key:'KeyE',       label:'E',     action:'Interagir'     },
  enterVehicle:{ key:'KeyF',       label:'F',     action:'Entrar Veículo'},
  aim:         { key:'Mouse2',     label:'RMB',   action:'Mirar'         },
  shoot:       { key:'Mouse0',     label:'LMB',   action:'Atirar'        },
  cover:       { key:'KeyQ',       label:'Q',     action:'Cover'         },
  roll:        { key:'KeyC',       label:'C',     action:'Rolar'         },
  reload:      { key:'KeyR',       label:'R',     action:'Recarregar'    },
  weapon1:     { key:'Digit1',     label:'1',     action:'Arma 1'        },
  weapon2:     { key:'Digit2',     label:'2',     action:'Arma 2'        },
  weapon3:     { key:'Digit3',     label:'3',     action:'Arma 3'        },
};

export const DEF_CHAR = {
  isChar: true,
  speed: 5, sprint: 10, jump: 6, accel: 15, rotSpd: 8,
  camY: 2.0, camD: 5,
  actions: { aim:true, car:true, cov:false, rol:false, crc:false, int:true },
  keybinds: null, // filled by createEnt
};
