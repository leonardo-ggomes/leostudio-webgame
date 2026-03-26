// ================================================================
// character.js — HUD overlay for preview mode
// NOTE: Mouse look, keydown/keyup and pointer lock are handled
// exclusively in main.js + inputManager.js to avoid duplication.
// ================================================================
import * as S from './state.js';

const pvCvs = document.getElementById('pv-canvas');
const pvCtx = pvCvs.getContext('2d');

export function drawHUD() {
  if (!S.pvActive || !S.pvChar) return;
  pvCtx.clearRect(0, 0, pvCvs.width, pvCvs.height);
  const w = pvCvs.width, h = pvCvs.height;
  const ch  = S.pvChar.controllable;
  const vel = S.pvChar._controller?.getVelocity?.() || new (class { x=0; z=0; })();

  const spd    = Math.sqrt((vel.x||0)**2 + (vel.z||0)**2);
  const maxSpd = ch ? (S.pvChar._controller?.isGrounded?.() !== false && ch.stats.sprint) || ch.stats.speed : 10;
  const grnd   = S.pvChar._controller?.isGrounded?.() ?? true;

  // Crosshair
  pvCtx.strokeStyle = 'rgba(255,255,255,.7)'; pvCtx.lineWidth = 1.5;
  pvCtx.beginPath();
  pvCtx.moveTo(w/2-10, h/2); pvCtx.lineTo(w/2+10, h/2);
  pvCtx.moveTo(w/2, h/2-10); pvCtx.lineTo(w/2, h/2+10);
  pvCtx.stroke();
  pvCtx.beginPath(); pvCtx.arc(w/2, h/2, 3, 0, Math.PI*2);
  pvCtx.fillStyle = 'rgba(255,255,255,.55)'; pvCtx.fill();

  // Speed bar
  pvCtx.fillStyle = 'rgba(0,0,0,.42)';
  pvCtx.roundRect(14, h-58, 158, 44, 6); pvCtx.fill();
  pvCtx.fillStyle = 'rgba(200,210,220,.8)'; pvCtx.font = 'bold 10px monospace';
  const animState = S.pvChar._controller?.getAnimState?.() || '—';
  pvCtx.fillText(animState.toUpperCase(), 22, h-41);
  pvCtx.fillStyle = 'rgba(91,140,255,.25)';
  pvCtx.roundRect(22, h-34, 138, 9, 3); pvCtx.fill();
  pvCtx.fillStyle = spd > (ch?.stats?.speed || 5) ? '#ffb347' : '#3ecf8e';
  pvCtx.roundRect(22, h-34, Math.min(138, (spd / Math.max(.01, maxSpd)) * 138), 9, 3); pvCtx.fill();

  // Info panel
  pvCtx.fillStyle = 'rgba(0,0,0,.42)';
  pvCtx.roundRect(w-172, h-58, 158, 44, 6); pvCtx.fill();
  pvCtx.fillStyle = 'rgba(200,210,220,.7)'; pvCtx.font = '10px monospace'; pvCtx.textAlign = 'right';
  const mp = S.pvChar.mesh.position;
  pvCtx.fillText(`${mp.x.toFixed(1)}, ${mp.y.toFixed(1)}, ${mp.z.toFixed(1)}`, w-20, h-41);
  pvCtx.fillText(grnd ? '● Chão' : '● Ar', w-20, h-26);
  pvCtx.textAlign = 'left';

  // Hint
  pvCtx.fillStyle = 'rgba(0,0,0,.32)';
  pvCtx.roundRect(w/2-155, 8, 310, 21, 5); pvCtx.fill();
  pvCtx.fillStyle = 'rgba(200,210,220,.55)'; pvCtx.font = '10px monospace'; pvCtx.textAlign = 'center';
  pvCtx.fillText('Clique para travar câmera · RMB mirar · Esc sair', w/2, 22);
  pvCtx.textAlign = 'left';
}
