// ================================================================
// animationManager.js — GLB AnimationMixer + state machine
// Handles Mixamo, Blender, and generic clip naming conventions.
// ================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ----------------------------------------------------------------
// Clip name normalizer
// Strips common prefixes: "Armature|Walk" → "walk"
//                         "mixamo.com"    → "mixamo.com"  (special case below)
// ----------------------------------------------------------------
function normalizeName(raw) {
  const afterPipe = raw.includes('|') ? raw.split('|').pop() : raw;
  return afterPipe.replace(/\.(fbx|bvh|glb|gltf)$/i, '').trim().toLowerCase();
}

// ----------------------------------------------------------------
// State rules — tested against normalized clip name
// ----------------------------------------------------------------
const RULES = [
  { state: 'idle',      patterns: ['idle', 'stand', 'standing', 'tpose', 't-pose', 'bind', 'rest', 'neutral'] },
  { state: 'walk',      patterns: ['walk', 'walking'] },
  { state: 'run',       patterns: ['run', 'running', 'jog', 'jogging', 'sprint', 'sprinting', 'fastrun'] },
  { state: 'jump',      patterns: ['jump', 'jumping', 'leap'] },
  { state: 'fall',      patterns: ['fall', 'falling', 'airborne', 'inair'] },
  { state: 'land',      patterns: ['land', 'landing'] },
  { state: 'crouch',    patterns: ['crouch', 'crouching', 'crawl', 'duck'] },
  { state: 'death',     patterns: ['death', 'die', 'dead', 'dying'] },
  { state: 'attack',    patterns: ['attack', 'punch', 'kick', 'swing', 'stab'] },
  { state: 'shoot',     patterns: ['shoot', 'fire', 'shooting', 'firing'] },
  { state: 'aim',       patterns: ['aim', 'aiming', 'strafe'] },
  { state: 'reload',    patterns: ['reload', 'reloading'] },
  { state: 'sit',       patterns: ['sit', 'sitting', 'seated', 'drive'] },
  { state: 'wave',      patterns: ['wave', 'waving', 'greet'] },
  { state: 'engine_on', patterns: ['engine', 'car_idle', 'idle_car', 'motor'] },
];

// ----------------------------------------------------------------
// AnimationManager
// ----------------------------------------------------------------
export class AnimationManager {
  constructor(root, clips) {
    this.root          = root;
    this.mixer         = new THREE.AnimationMixer(root);
    this.clips         = clips;
    this.actions       = {};
    this.stateMap      = {};
    this.currentState  = null;
    this.currentAction = null;
    this.fadeDuration  = 0.2;
    this._locked       = false;  // true while a LoopOnce clip is playing

    this._buildActions();
    this._autoMap();
    this._logDiagnostics();
  }

  _buildActions() {
    this.clips.forEach(clip => {
      const action = this.mixer.clipAction(clip);
      action.stop();
      this.actions[clip.name] = action;
      // When a LoopOnce clip finishes, unlock the state machine
      this.mixer.addEventListener('finished', e => {
        if (e.action === action) this._locked = false;
      });
    });
  }

  _autoMap() {
    this.stateMap = {};
    this.clips.forEach(clip => {
      const norm = normalizeName(clip.name);
      for (const rule of RULES) {
        const hit = rule.patterns.some(p => norm === p || norm.includes(p));
        if (hit && !this.stateMap[rule.state]) {
          this.stateMap[rule.state] = clip.name;
          break;
        }
      }
    });
    // Fallback: no idle → first clip
    if (!this.stateMap.idle && this.clips.length > 0) {
      this.stateMap.idle = this.clips[0].name;
    }
  }

  _logDiagnostics() {
    console.group('[EngineLeo] AnimationManager');
    console.log(`Clips: ${this.clips.length}`);
    this.clips.forEach(c => {
      const norm   = normalizeName(c.name);
      const mapped = Object.entries(this.stateMap).find(([, v]) => v === c.name);
      console.log(`  "${c.name}" → norm:"${norm}" → state:${mapped ? mapped[0] : '—'} (${c.duration.toFixed(2)}s)`);
    });
    console.log('stateMap:', { ...this.stateMap });
    console.groupEnd();
  }

  setState(state, { once = false } = {}) {
    // If a LoopOnce clip (jump/land/attack) is playing, don't interrupt it
    if (this._locked && !once) return;
    if (this.currentState === state) return;

    const clipName = this.stateMap[state];
    if (!clipName) return;
    const action = this.actions[clipName];
    if (!action) return;

    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    this._locked = once; // lock state machine while this plays

    if (this.currentAction && this.currentAction !== action) {
      action.crossFadeFrom(this.currentAction, this.fadeDuration, true);
    }
    action.play();
    this.currentState  = state;
    this.currentAction = action;
  }

  playClip(name) {
    const action = this.actions[name];
    if (!action) { console.warn('[EngineLeo] clip not found:', name); return; }
    if (this.currentAction && this.currentAction !== action) {
      action.reset().crossFadeFrom(this.currentAction, this.fadeDuration, true);
    } else {
      action.reset();
    }
    action.setLoop(THREE.LoopRepeat, Infinity).play();
    this.currentState  = name;
    this.currentAction = action;
  }

  mapState(state, clipName) {
    if (!clipName) delete this.stateMap[state];
    else this.stateMap[state] = clipName;
    console.log(`[EngineLeo] mapState "${state}" → "${clipName}"`);
  }

  stopAll() {
    this.mixer.stopAllAction();
    this.currentState = null; this.currentAction = null; this._locked = false;
  }

  update(dt) { this.mixer.update(dt); }

  // Returns list for inspector panel — shows displayName (normalized) in UI
  getClipList() {
    const rev = {};
    Object.entries(this.stateMap).forEach(([s, c]) => { rev[c] = s; });
    return this.clips.map(c => ({
      name:        c.name,
      displayName: normalizeName(c.name),
      state:       rev[c.name] || null,
      duration:    c.duration.toFixed(2),
    }));
  }

  reAutoMap() { this._autoMap(); this._logDiagnostics(); }

  static get ALL_STATES() { return RULES.map(r => r.state); }
}

// ----------------------------------------------------------------
// GLB loader
// ----------------------------------------------------------------
export function loadGLB(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, gltf => {
      const root  = gltf.scene;
      const clips = gltf.animations || [];
      root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(root);
      const h   = box.max.y - box.min.y;
      if (h > 0.01) root.scale.setScalar(1.8 / h);
      if (!clips.length) console.warn('[EngineLeo] GLB sem animações:', url);
      resolve({ scene: root, clips, animMgr: clips.length ? new AnimationManager(root, clips) : null });
    }, undefined, err => { console.error('[EngineLeo] GLB erro:', err); reject(err); });
  });
}