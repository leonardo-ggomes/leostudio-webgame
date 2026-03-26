// ================================================================
// inputManager.js — Unified input state for all controllers
// All controllers receive the same InputState object each frame.
// ================================================================
import * as S from './state.js';

/** @type {Set<string>} */
const held = new Set();
let mouseButtons = 0; // bitmask: bit0=LMB, bit1=MMB, bit2=RMB

// Raw listeners — always active
window.addEventListener('keydown', e => held.add(e.code));
window.addEventListener('keyup',   e => held.delete(e.code));
document.getElementById('vp').addEventListener('mousedown', e => { mouseButtons |=  (1 << e.button); });
document.getElementById('vp').addEventListener('mouseup',   e => { mouseButtons &= ~(1 << e.button); });

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
