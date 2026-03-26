// ================================================================
// character.js — HUD overlay for preview mode
// ================================================================
import * as S from './state.js';

const pvCvs = document.getElementById('pv-canvas');
const pvCtx = pvCvs.getContext('2d');

const TYPE_LABELS = {
  humanoid:   { icon:'⬤', color:'#3ecf8e' },
  vehicle:    { icon:'🚗', color:'#ffb347' },
  helicopter: { icon:'🚁', color:'#9b72ff' },
  aircraft:   { icon:'✈', color:'#5bc9c9'  },
};

export function drawHUD() {
  if (!S.pvActive || !S.pvChar) return;
  pvCtx.clearRect(0, 0, pvCvs.width, pvCvs.height);
  const w = pvCvs.width, h = pvCvs.height;
  const ent  = S.pvChar;
  const ctrl = ent._controller;
  const type = ent.controllable?.type || 'humanoid';
  const meta = TYPE_LABELS[type] || TYPE_LABELS.humanoid;

  const vel   = ctrl?.getVelocity?.() || { x:0, y:0, z:0 };
  const hSpd  = Math.sqrt((vel.x||0)**2 + (vel.z||0)**2);
  const vSpd  = vel.y || 0;
  const alt   = Math.max(0, ent.mesh.position.y).toFixed(1);
  const state = ctrl?.getAnimState?.() || '—';
  const grnd  = ctrl?.isGrounded?.() ?? true;
  const thrott = ctrl?.getThrottle?.();    // aircraft only
  const speed  = ctrl?.getSpeed?.();       // vehicle/aircraft

  // ---- Crosshair ----
  pvCtx.strokeStyle = 'rgba(255,255,255,.7)'; pvCtx.lineWidth = 1.5;
  pvCtx.beginPath();
  pvCtx.moveTo(w/2-10, h/2); pvCtx.lineTo(w/2+10, h/2);
  pvCtx.moveTo(w/2, h/2-10); pvCtx.lineTo(w/2, h/2+10);
  pvCtx.stroke();
  pvCtx.beginPath(); pvCtx.arc(w/2, h/2, 3, 0, Math.PI*2);
  pvCtx.fillStyle = 'rgba(255,255,255,.55)'; pvCtx.fill();

  // ---- Bottom-left panel ----
  pvCtx.fillStyle = 'rgba(0,0,0,.5)';
  pvCtx.roundRect(12, h-84, 180, 72, 7); pvCtx.fill();

  pvCtx.font = 'bold 11px monospace';
  pvCtx.fillStyle = meta.color;
  pvCtx.fillText(`${meta.icon} ${type.toUpperCase()}`, 22, h-67);

  pvCtx.font = '10px monospace'; pvCtx.fillStyle = 'rgba(200,210,220,.8)';
  if (type === 'aircraft') {
    pvCtx.fillText(`Throttle: ${thrott !== undefined ? (thrott*100).toFixed(0)+'%' : '—'}`, 22, h-52);
    pvCtx.fillText(`Speed: ${speed !== undefined ? speed.toFixed(1)+' m/s' : hSpd.toFixed(1)+' m/s'}`, 22, h-37);
    pvCtx.fillText(`Alt: ${alt} m`, 22, h-22);
  } else if (type === 'helicopter') {
    pvCtx.fillText(`H-Speed: ${hSpd.toFixed(1)} m/s`, 22, h-52);
    pvCtx.fillText(`V-Speed: ${vSpd > 0 ? '+' : ''}${vSpd.toFixed(1)} m/s`, 22, h-37);
    pvCtx.fillText(`Alt: ${alt} m`, 22, h-22);
  } else if (type === 'vehicle') {
    pvCtx.fillText(`Speed: ${Math.abs(speed || hSpd).toFixed(1)} m/s`, 22, h-52);
    pvCtx.fillText(`${speed < 0 ? '← RÉ' : '→ FRENTE'}`, 22, h-37);
    pvCtx.fillText(grnd ? '● Chão' : '● Ar', 22, h-22);
  } else {
    pvCtx.fillText(state.toUpperCase(), 22, h-52);
    pvCtx.fillText(`Speed: ${hSpd.toFixed(1)} m/s`, 22, h-37);
    pvCtx.fillText(grnd ? '● Chão' : '● Ar', 22, h-22);
  }

  // ---- Speed bar ----
  const maxHSpd = ent.controllable?.stats?.topSpeed || ent.controllable?.stats?.speed || 10;
  pvCtx.fillStyle = 'rgba(91,140,255,.2)';
  pvCtx.roundRect(12, h-10, 180, 6, 3); pvCtx.fill();
  pvCtx.fillStyle = meta.color;
  pvCtx.roundRect(12, h-10, Math.min(180, (hSpd / maxHSpd) * 180), 6, 3); pvCtx.fill();

  // ---- Bottom-right: position ----
  pvCtx.fillStyle = 'rgba(0,0,0,.42)';
  pvCtx.roundRect(w-180, h-50, 168, 38, 6); pvCtx.fill();
  pvCtx.fillStyle = 'rgba(200,210,220,.7)'; pvCtx.font = '10px monospace'; pvCtx.textAlign = 'right';
  const mp = ent.mesh.position;
  pvCtx.fillText(`${mp.x.toFixed(1)}, ${mp.y.toFixed(1)}, ${mp.z.toFixed(1)}`, w-20, h-33);
  pvCtx.fillText('T = alternar câmera · F = entrar/sair', w-20, h-18);
  pvCtx.textAlign = 'left';

  // ---- Top hint ----
  pvCtx.fillStyle = 'rgba(0,0,0,.32)';
  pvCtx.roundRect(w/2-175, 8, 350, 21, 5); pvCtx.fill();
  pvCtx.fillStyle = 'rgba(200,210,220,.55)'; pvCtx.font = '10px monospace'; pvCtx.textAlign = 'center';
  const hint = type === 'aircraft'
    ? 'WASD pitch/roll · Shift throttle · Space airbrake · Q/E yaw · F sair'
    : type === 'helicopter'
    ? 'WASD move · Space subir · Ctrl descer · Q/E yaw · F sair · T câmera'
    : 'Clique para travar câmera · RMB girar · F entrar veículo · T câmera · Esc sair';
  pvCtx.fillText(hint, w/2, 22);
  pvCtx.textAlign = 'left';
}
