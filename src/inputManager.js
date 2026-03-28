// ================================================================
// inputManager.js — Unified input state for all controllers
// All controllers receive the same InputState object each frame.
//
// FIX: adicionado suporte a mousemove com pointer lock.
//   - mouseDX / mouseDY acumulam delta do mouse por frame
//   - consumeMouseDelta() deve ser chamado 1x por frame no loop principal
//     (ou pelo controllableSystem.update) para zerar os deltas
//   - requestPointerLock / releasePointerLock expõem controle explícito
// ================================================================
import * as S from './state.js';

/** @type {Set<string>} */
const held = new Set();
let mouseButtons = 0; // bitmask: bit0=LMB, bit1=MMB, bit2=RMB

// ---- Mouse delta acumulado entre frames ----
let _dx = 0;
let _dy = 0;
let _pointerLocked = false;

// Raw listeners — always active
window.addEventListener('keydown', e => { held.add(e.code); });
window.addEventListener('keyup',   e => { held.delete(e.code); });

// Mouse buttons: listen on DOCUMENT so pointer-lock doesn't swallow events
document.addEventListener('mousedown', e => { mouseButtons |=  (1 << e.button); });
document.addEventListener('mouseup',   e => { mouseButtons &= ~(1 << e.button); });

// ---- Pointer Lock — captura movimento bruto do mouse ----
// movementX/Y só ficam disponíveis enquanto o pointer estiver locked,
// mas registramos no document para funcionar tanto em play quanto em preview.
document.addEventListener('mousemove', e => {
  if (_pointerLocked) {
    // Pointer lock ativo: usa movimento bruto (sem aceleração do SO)
    _dx += e.movementX;
    _dy += e.movementY;
  }
  // Sem pointer lock: ignora (o mouse está livre para UI)
});

document.addEventListener('pointerlockchange', () => {
  _pointerLocked = document.pointerLockElement !== null;
});

document.addEventListener('pointerlockerror', () => {
  console.warn('[InputManager] Pointer lock negado pelo navegador.');
  _pointerLocked = false;
});

/** Solicita pointer lock no canvas do jogo */
export function requestPointerLock() {
  const vp = document.getElementById('vp');
  if (vp && document.pointerLockElement !== vp) {
    vp.requestPointerLock();
  }
}

/** Libera pointer lock (ex: ao abrir menu de pausa) */
export function releasePointerLock() {
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }
}

/** Retorna true se o pointer estiver locked */
export function isPointerLocked() {
  return _pointerLocked;
}

/**
 * Consome e zera os deltas do mouse.
 * Deve ser chamado 1x por frame, ANTES de sample().
 * Aplica sensibilidade e atualiza S.camYaw / S.camPitch diretamente.
 *
 * @param {number} sensitivity  Sensibilidade horizontal+vertical (padrão 0.002)
 * @param {number} pitchMin     Limite inferior do pitch (padrão -1.4 rad)
 * @param {number} pitchMax     Limite superior do pitch (padrão  0.6 rad)
 */
export function consumeMouseDelta(sensitivity = 0.002, pitchMin = -1.4, pitchMax = 0.6) {
  if (_dx !== 0 || _dy !== 0) {
    S.setCamYaw(S.camYaw - _dx * sensitivity);
    S.setCamPitch(Math.max(pitchMin, Math.min(pitchMax, S.camPitch - _dy * sensitivity)));
    _dx = 0;
    _dy = 0;
  }
}

/**
 * Retorna os deltas brutos sem zerá-los (para debug ou uso customizado).
 */
export function peekMouseDelta() {
  return { dx: _dx, dy: _dy };
}

/** Build an InputState from a keybind map */
export function sample(keybinds) {
  const kb = keybinds;
  return {
    forward:      isDown(kb.forward),
    backward:     isDown(kb.backward),
    left:         isDown(kb.left),
    right:        isDown(kb.right),
    sprint:       isDown(kb.sprint),
    jump:         isDown(kb.jump),
    crouch:       isDown(kb.crouch),
    interact:     isDown(kb.interact),
    enterVehicle: isDown(kb.enterVehicle),
    aim:          isDown(kb.aim),
    shoot:        isDown(kb.shoot),
    cover:        isDown(kb.cover),
    roll:         isDown(kb.roll),
    reload:       isDown(kb.reload),
    weapon1:      isDown(kb.weapon1),
    weapon2:      isDown(kb.weapon2),
    weapon3:      isDown(kb.weapon3),
    // raw
    heldKeys: held,
    mouseButtons,
  };
}

function isDown(bind) {
  if (!bind) return false;
  if (bind.key === 'Mouse0') return !!(mouseButtons & 1);
  if (bind.key === 'Mouse1') return !!(mouseButtons & 2);
  if (bind.key === 'Mouse2') return !!(mouseButtons & 4);
  return held.has(bind.key);
}

/** For keybind rebinding UI */
export function nextKey() {
  return new Promise(resolve => {
    const onKey   = e => { cleanup(); resolve({ code: e.code,   label: e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key }); };
    const onMouse = e => { const labels=['LMB','MMB','RMB']; cleanup(); resolve({ code:`Mouse${e.button}`, label: labels[e.button]||`M${e.button}` }); };
    function cleanup() { window.removeEventListener('keydown', onKey); document.getElementById('vp').removeEventListener('mousedown', onMouse); }
    window.addEventListener('keydown', onKey, { once: true });
    document.getElementById('vp').addEventListener('mousedown', onMouse, { once: true });
  });
}