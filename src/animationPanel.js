// ================================================================
// animationPanel.js — Inspector tab: Animações
// Lists GLB clips, shows auto-mapped states, allows manual override.
// ================================================================
import { AnimationManager } from './animationManager.js';
import * as S from './state.js';

const $ = id => document.getElementById(id);

export function refresh() {
  const ent = S.selEnt;
  const hasMgr = !!ent?.animMgr;

  $('nsel-anim').style.display  = hasMgr ? 'none' : 'flex';
  $('anim-fields').style.display = hasMgr ? 'block' : 'none';

  if (!hasMgr) {
    $('nsel-anim').querySelector('.no-sel-txt').textContent =
      ent ? 'Objeto sem animações\n(carregue um GLB com clips)' : 'Nenhum objeto\nselecionado';
    return;
  }

  _renderClipList(ent);
  _renderStateMap(ent);
  _renderSettings(ent);
}

// ---- Clip list ----
function _renderClipList(ent) {
  const container = $('anim-clip-list');
  container.innerHTML = '';
  const clips = ent.animMgr.getClipList();

  clips.forEach(({ name, state, duration }) => {
    const row = document.createElement('div');
    row.className = 'anim-clip-row';
    row.innerHTML = `
      <button class="anim-play-btn" title="Preview" onclick="window.animPreview('${CSS.escape(name)}')">▶</button>
      <div class="anim-clip-name" title="${name}">${_shortName(name)}</div>
      <div class="anim-clip-dur">${duration}s</div>
      <div class="anim-clip-state ${state ? 'mapped' : ''}">${state || '—'}</div>
    `;
    container.appendChild(row);
  });
}

// ---- State → Clip mapping ----
function _renderStateMap(ent) {
  const container = $('anim-state-map');
  container.innerHTML = '';
  const clips = ent.animMgr.clips.map(c => c.name);

  AnimationManager.ALL_STATES.forEach(state => {
    const current = ent.animMgr.stateMap[state] || '';
    const row = document.createElement('div');
    row.className = 'anim-map-row';
    row.innerHTML = `
      <div class="anim-state-lbl">${state}</div>
      <select class="anim-state-sel ins-sel" onchange="window.animMapState('${state}', this.value)">
        <option value="">— não mapeado —</option>
        ${clips.map(c => `<option value="${c}" ${c===current?'selected':''}>${_shortName(c)}</option>`).join('')}
      </select>
    `;
    container.appendChild(row);
  });
}

// ---- Settings ----
function _renderSettings(ent) {
  const mgr = ent.animMgr;
  const fd = $('anim-fade');
  if (fd) fd.value = mgr.fadeDuration;
}

// ---- Handlers (called from HTML via window.*) ----
export function preview(clipName) {
  const ent = S.selEnt;
  if (!ent?.animMgr) return;
  ent.animMgr.playClip(clipName);
}

export function mapState(state, clipName) {
  const ent = S.selEnt;
  if (!ent?.animMgr) return;
  ent.animMgr.mapState(state, clipName || null);
  refresh(); // re-render clip list badges
}

export function applyFade() {
  const ent = S.selEnt;
  if (!ent?.animMgr) return;
  ent.animMgr.fadeDuration = parseFloat($('anim-fade').value) || 0.25;
}

// ---- Helpers ----
function _shortName(name) {
  // Strip common prefixes like "Armature|" or "Character|"
  return name.replace(/^[^|]+\|/, '').replace(/^mixamo\.com\//, '');
}
