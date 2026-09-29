/**
 * Look at the extension folder before handing it to the browser, so that
 * "the extension did not load" comes with a reason: a file the manifest names
 * that is not there, an import that points nowhere, a file that does not
 * parse. Chrome itself only says that loading failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @param {string} extDir
 * @returns {{ ok: boolean, problems: string[], missingContentScripts: string[], files: number }}
 */
export function preflight(extDir) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const missingContentScripts = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
  } catch (e) {
    return { ok: false, problems: [`manifest.json does not parse: ${e instanceof Error ? e.message : e}`], missingContentScripts, files: 0 };
  }

  const exists = (rel) => fs.existsSync(path.join(extDir, rel));
  for (const cs of manifest.content_scripts || []) {
    for (const f of cs.js || []) {
      if (!exists(f)) {
        missingContentScripts.push(f);
        problems.push(`manifest.json lists content script ${f}, which does not exist`);
      }
    }
  }
  const sw = manifest.background && manifest.background.service_worker;
  if (!sw || !exists(sw)) problems.push(`service worker ${sw} does not exist`);
  const panel = manifest.side_panel && manifest.side_panel.default_path;
  if (panel && !exists(panel)) problems.push(`side panel page ${panel} does not exist`);

  // Follow relative imports from every module entry point.
  const entries = [sw, 'src/sidepanel/panel.js', 'src/offscreen/offscreen.js'].filter((f) => f && exists(f));
  const visited = new Set();
  /** @type {Map<string, Set<string>>} */
  const wanted = new Map();
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:([\s\S]*?)\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
  const walk = (rel) => {
    if (visited.has(rel)) return;
    visited.add(rel);
    let text;
    try {
      text = fs.readFileSync(path.join(extDir, rel), 'utf8');
    } catch {
      return;
    }
    for (const m of text.matchAll(IMPORT_RE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2]));
      if (!exists(target)) {
        problems.push(`${rel} imports ${m[2]}, which does not exist`);
        continue;
      }
      const names = /\{([^}]*)\}/.exec(m[1] || '');
      if (names && /^\s*import\b/.test(m[0])) {
        const set = wanted.get(target) || new Set();
        for (const n of names[1].split(',')) {
          const name = n.trim().split(/\s+as\s+/)[0].trim();
          if (name) set.add(`${name}\u0000${rel}`);
        }
        wanted.set(target, set);
      }
      walk(target);
    }
  };
  entries.forEach(walk);

  // A named import of something the target never exports stops a module graph cold.
  for (const [target, set] of wanted) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(extDir, target), 'utf8');
    } catch {
      continue;
    }
    if (/export\s+\*\s+from/.test(text)) continue;
    for (const item of set) {
      const [name, from] = item.split('\u0000');
      const re = new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${name.replace(/[$]/g, '\\$')}\\b|export\\s*\\{[^}]*\\b${name.replace(/[$]/g, '\\$')}\\b[^}]*\\}`);
      if (!re.test(text)) problems.push(`${from} imports { ${name} } from ${target}, which does not export it`);
    }
  }

  // Syntax. Module files are checked as modules, content scripts as classic scripts.
  const all = [];
  const collect = (dir) => {
    for (const e of fs.readdirSync(path.join(extDir, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) collect(rel);
      else if (e.name.endsWith('.js')) all.push(rel);
    }
  };
  if (exists('src')) collect('src');
  for (const rel of all) {
    const abs = path.join(extDir, rel);
    const asModule = visited.has(rel) || /^\s*(import|export)\s/m.test(fs.readFileSync(abs, 'utf8'));
    const args = asModule ? ['--experimental-default-type=module', '--check', abs] : ['--check', abs];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    if (r.status !== 0) {
      const line = (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || (r.stderr || '').trim().split('\n')[0] || 'does not parse';
      problems.push(`${rel} does not parse: ${line.trim()}`);
    }
  }

  return { ok: problems.length === 0, problems, missingContentScripts, files: all.length };
}
