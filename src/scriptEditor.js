// ================================================================
// scriptEditor.js — Monaco editor + Behaviour script runtime
// ================================================================
import * as S from './state.js';

const DEF_CODE = `// DragonEngine — Behaviour Script
// API: this.entity · this.entity.mesh · this.entity.physics · this.entity.char

class MeuScript extends Behaviour {
  onStart() {
    console.log('[DE] Iniciado:', this.entity.name);
    this.tempo = 0;
  }
  onUpdate(dt) {
    this.tempo += dt;
    this.entity.mesh.rotation.y = this.tempo * 0.8;
  }
  onCollision(other) {
    console.log('[DE] Colisao com', other?.name);
  }
}
`;

let curScript = null;
let monacoEd  = null;
let monacoRdy = false;

export function add(ent) {
  if (!ent) return;
  const n = 'Script' + (ent.scripts.length + 1);
  ent.scripts.push(n);
  ent.scriptCodes[n] = DEF_CODE;
  return n;
}

export function remove(ent, name) {
  if (!ent) return;
  ent.scripts = ent.scripts.filter(s => s !== name);
  delete ent.scriptCodes[name];
  if (ent._si) delete ent._si[name];
}

export function open(ent, name) {
  if (!ent) return;
  curScript = name;
  document.getElementById('sc-name').textContent   = name + '.js';
  document.getElementById('sc-status').textContent = '● editando';
  document.getElementById('sc-overlay').classList.add('open');
  const code = ent.scriptCodes[name] || DEF_CODE;
  if (!monacoRdy) _initMonaco(code);
  else if (monacoEd) monacoEd.setValue(code);
  else { const fb=document.getElementById('sc-fb'); if (fb) fb.value=code; }
}

export function close() {
  document.getElementById('sc-overlay').classList.remove('open');
}

export function apply(ent) {
  if (!ent || !curScript) return;
  const code = monacoEd ? monacoEd.getValue() : (document.getElementById('sc-fb')?.value||'');
  ent.scriptCodes[curScript] = code;
  try {
    const Cls = _compile(code);
    if (Cls && S.playing) {
      const i = new Cls(ent); i.onStart();
      ent._si[curScript] = i;
    }
    document.getElementById('sc-status').textContent = '✓ aplicado';
    return { ok: true };
  } catch(err) {
    document.getElementById('sc-status').textContent = '✕ ' + err.message;
    return { ok: false, err };
  }
}

export function startAll(ent) {
  ent._si = {};
  (ent.scripts||[]).forEach(sn => {
    const code = ent.scriptCodes[sn]; if (!code) return;
    try {
      const Cls = _compile(code);
      if (Cls) { const i=new Cls(ent); i.onStart(); ent._si[sn]=i; }
    } catch(e) { console.warn('[DE Script]', sn, e); }
  });
}

export function tickAll(ent, dt) {
  Object.values(ent._si||{}).forEach(i => { try { i.onUpdate(dt); } catch(e){} });
}

function _compile(code) {
  const B = class { constructor(e){this.entity=e;} onStart(){} onUpdate(dt){} onCollision(o){} };
  const fn = new Function('Behaviour', code + '\nreturn typeof MeuScript!=="undefined"?MeuScript:null;');
  return fn(B);
}

function _initMonaco(code) {
  const wrap = document.getElementById('monaco-wrap');
  wrap.innerHTML = `<textarea id="sc-fb" style="width:100%;height:100%;background:#0d0e11;color:#c8cdd8;font-family:'JetBrains Mono',monospace;font-size:13px;border:none;outline:none;padding:18px;resize:none;line-height:1.65;tab-size:2">${code.replace(/</g,'&lt;')}</textarea>`;
  monacoRdy = true;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.34.1/min/vs/loader.js';
  s.onload = () => {
    require.config({ paths:{ vs:'https://cdn.jsdelivr.net/npm/monaco-editor@0.34.1/min/vs' } });
    require(['vs/editor/editor.main'], monaco => {
      wrap.innerHTML = '<div id="mc-actual" style="width:100%;height:100%"></div>';
      monacoEd = monaco.editor.create(document.getElementById('mc-actual'), {
        value: code, language:'javascript', theme:'vs-dark',
        fontSize:13, fontFamily:'JetBrains Mono,Cascadia Code,monospace',
        minimap:{enabled:false}, scrollBeyondLastLine:false, automaticLayout:true,
      });
      monacoEd.onDidChangeModelContent(() => {
        document.getElementById('sc-status').textContent = '● modificado';
      });
    });
  };
  document.head.appendChild(s);
}
