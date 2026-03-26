// ================================================================
// serializer.js — Export/Import JSON, Import GLTF/GLB
// ================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as S from './state.js';
import { createEnt } from './entities.js';
import { DEF_KB } from './state.js';
import { showModal, showToast } from './ui.js';

export function exportScene() {
  const data = {
    version: '2.0', engine: 'EngineLeo', ts: new Date().toISOString(),
    entities: S.entities.map(e => ({
      id: e.id, name: e.name, type: e.type, layer: e.layer||'default', visible: e.visible,
      transform: {
        position: e.mesh.position.toArray(),
        rotation: [e.mesh.rotation.x, e.mesh.rotation.y, e.mesh.rotation.z],
        scale:    e.mesh.scale.toArray(),
      },
      physics: e.physics ? {
        enabled:e.physics.enabled, type:e.physics.type, mass:e.physics.mass,
        gravity:e.physics.gravity, friction:e.physics.friction,
        restitution:e.physics.restitution, collider:e.physics.collider,
      } : null,
      controllable: e.controllable ? { type: e.controllable.type, stats: e.controllable.stats, keybinds: e.controllable.keybinds } : null,
      scripts: e.scripts, scriptCodes: e.scriptCodes,
    })),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }));
  a.download = 'scene.json'; a.click();
  showToast('✓ Cena exportada como scene.json');
}

export function importScene(file, onDone) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.entities) throw new Error('Campo "entities" não encontrado');
      showModal(
        'Importar Cena',
        `Arquivo: ${file.name}\nEntidades: ${data.entities.length}\nVersão: ${data.version||'?'}\n\nA cena atual será substituída.`,
        [
          { label:'Cancelar', cls:'' },
          { label:'Importar', cls:'pri', action: () => {
            // Clear old scene
            S.entities.forEach(e => { S.scene.remove(e.mesh); if (e.helper) S.scene.remove(e.helper); });
            S.setEntities([]);
            S.setNextId(1);

            // Rebuild
            data.entities.forEach(d => {
              const ent = createEnt(d.type, d.name);
              if (d.transform) {
                ent.mesh.position.fromArray(d.transform.position||[0,0,0]);
                ent.mesh.rotation.set(...(d.transform.rotation||[0,0,0]));
                ent.mesh.scale.fromArray(d.transform.scale||[1,1,1]);
              }
              ent.visible = d.visible !== false; ent.mesh.visible = ent.visible;
              ent.layer   = d.layer || 'default';
              if (d.physics && ent.physics) Object.assign(ent.physics, d.physics);
              if (d.controllable && ent.controllable) {
                Object.assign(ent.controllable, d.controllable);
              } else if (d.char && ent.controllable) {
                // Migrate legacy 'char' field to controllable stats
                const ch = d.char;
                if (ch.speed    !== undefined) ent.controllable.stats.speed    = ch.speed;
                if (ch.sprint   !== undefined) ent.controllable.stats.sprint   = ch.sprint;
                if (ch.jump     !== undefined) ent.controllable.stats.jump     = ch.jump;
                if (ch.keybinds !== undefined) ent.controllable.keybinds       = ch.keybinds;
              }
              ent.scripts = d.scripts || [];
              ent.scriptCodes = d.scriptCodes || {};
            });
            showToast(`✓ Importado: ${data.entities.length} entidades`);
            if (onDone) onDone();
          }},
        ]
      );
    } catch(err) {
      showModal('Erro ao importar', err.message, [{ label:'OK', cls:'' }]);
    }
  };
  rd.readAsText(file);
}

export function importGLTF(file, onDone) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const loader = new GLTFLoader();
  showToast('Carregando ' + file.name + '...');
  loader.load(url, gltf => {
    const root = gltf.scene;
    root.traverse(c => { if (c.isMesh) { c.castShadow=true; c.receiveShadow=true; } });
    const box = new THREE.Box3().setFromObject(root);
    const sz = box.getSize(new THREE.Vector3()).length();
    if (sz > 0) root.scale.setScalar(Math.min(1, 5/sz));
    S.scene.add(root);
    const ent = {
      id: S.nextId, name: file.name.replace(/\.[^.]+$/,''), type:'gltf',
      mesh:root, visible:true, layer:'default',
      physics:{ enabled:false, type:'static', mass:1, gravity:false,
                friction:.5, restitution:0, collider:'mesh',
                velocity:new THREE.Vector3(), angularVel:new THREE.Vector3(), grounded:false },
      controllable:null, animMgr:null, scripts:[], scriptCodes:{}, _si:{},
    };
    S.setNextId(S.nextId+1);
    S.entities.push(ent);
    showToast('✓ ' + file.name + ' importado!');
    if (onDone) onDone(ent);
  }, undefined, err => {
    showModal('Erro GLTF', err.message||'Arquivo inválido', [{ label:'OK', cls:'' }]);
  });
}
