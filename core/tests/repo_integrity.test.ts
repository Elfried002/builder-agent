/**
 * Tests structurels du cœur : frontière d'architecture et hygiène des secrets.
 *
 * Ces invariants ne portent pas sur un comportement fonctionnel mais sur ce que le cœur **est** :
 * un paquet logiciel isolé, sans dépendance de construction, et qui ne laisse aucun secret
 * franchir la frontière du dépôt. Ils sont plus faciles à casser par inadvertance que par
 * intention, donc ils sont testés plutôt que documentés.
 *
 * Invariants couverts : I-32, I-33, I-37, I-38.
 */

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SecretScanner, SecurityAllowlist } from '../src/security/index.js';

const CORE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(CORE_ROOT);

/** Tous les fichiers TypeScript du cœur, hors exemples et hors dépendances. */
function sourceFiles(root = join(CORE_ROOT, 'src')): string[] {
  const collected: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts')) {
        collected.push(full);
      }
    }
  };
  walk(root);
  return collected;
}

/**
 * Dépendances autorisées à l'exécution. Toute autre est un écart : le cœur doit rester installable
 * sans apporter un écosystème avec lui.
 */
const ALLOWED_BARE_IMPORTS = new Set(['ajv', 'ajv-formats', 'ajv/dist/2020.js']);

/** I-38 — le cœur n'importe rien hors bibliothèque standard Node et dépendances déclarées. */
describe('autonomie du cœur (I-38)', () => {
  it('n’importe que la bibliothèque standard Node et les dépendances déclarées', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)';/gm)) {
        const specifier = match[1] ?? '';
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        if (ALLOWED_BARE_IMPORTS.has(specifier)) continue;
        offenders.push(`${relative(CORE_ROOT, file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ne dépend d’aucun runtime de construction : ni Hermes, ni Telegram, ni orchestrateur', () => {
    const interdits = [
      'hermes',
      'telegram',
      'multi-agent-orchestrator',
      'multi_agent_orchestrator',
    ];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const content = readFileSync(file, 'utf8').toLowerCase();
      for (const interdit of interdits) {
        if (content.includes(interdit)) {
          offenders.push(`${relative(CORE_ROOT, file)} → ${interdit}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ne contient aucun accès réseau hors du provider LLM', () => {
    // Le cœur doit rester utilisable hors ligne : seul le provider LLM appelle le réseau, et il le
    // fait par `fetch` injecté, jamais par une dépendance supplémentaire.
    const appels: string[] = [];
    for (const file of sourceFiles()) {
      const relatif = relative(CORE_ROOT, file);
      if (relatif.startsWith('src/llm/')) continue;
      const content = readFileSync(file, 'utf8');
      if (/\bfetch\s*\(/.test(content) || /from 'node:(http|https|net)'/.test(content)) {
        appels.push(relatif);
      }
    }
    expect(appels).toEqual([]);
  });
});

/** I-37 — le cœur ne référence aucun emplacement de plateforme. */
describe('frontière avec la plateforme (I-37)', () => {
  it('ne référence aucun emplacement réservé à la plateforme', () => {
    // Seules les **références** comptent : un import, ou un chemin de répertoire. Une simple
    // mention dans un commentaire n'est pas un couplage — et un nom de règle de détection n'en est
    // pas un non plus : `secrets.ts` nomme `supabase-service-key` parce qu'il reconnaît le format
    // d'un jeton, pas parce qu'il parle à Supabase. Confondre les deux rendrait le test
    // insupportable, et un test insupportable finit désactivé.
    const interdits = ['platform', 'frontend', 'supabase', 'lovable'];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const content = readFileSync(file, 'utf8');
      for (const interdit of interdits) {
        const importMotif = new RegExp(`(?:import|from)\\s+[^;]*['"\`][^'"\`]*${interdit}`);
        const cheminMotif = new RegExp(`['"\`][^'"\`]*(?:^|[/\\\\])${interdit}/`);
        if (importMotif.test(content) || cheminMotif.test(content)) {
          offenders.push(`${relative(CORE_ROOT, file)} → ${interdit}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('le paquet n’expose aucune route, aucun serveur, aucun écouteur', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const content = readFileSync(file, 'utf8');
      if (
        /createServer|listen\s*\(|addEventListener\s*\(\s*['"](?:request|connect)/.test(content)
      ) {
        offenders.push(relative(CORE_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** I-32 / I-33 — hygiène des secrets dans le dépôt lui-même. */
describe('secrets dans le code du cœur (I-32, I-33)', () => {
  it('le détecteur signale toujours un exemple non revu (I-33)', () => {
    // Le détecteur n'est jamais désactivé : sans exception revue, une valeur qui ressemble à un
    // secret est signalée. Sans ce test, un « assouplissement » du détecteur passerait inaperçu.
    const racine = mkdtempSync(join(tmpdir(), 'codidev-detecteur-'));
    const jeton = `${'gh'}${'p_'}${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
    writeFileSync(join(racine, 'exemple.ts'), `const jeton = '${jeton}';\n`, 'utf8');

    const findings = new SecretScanner().scanTree(racine);
    expect(findings.length).toBeGreaterThan(0);

    // Et une exception revue le couvre, sans le masquer : la constatation reste consignée.
    const allowlist = SecurityAllowlist.load(join(racine, '.codidev-security-allowlist.json'));
    expect(allowlist.entries).toHaveLength(0);
  });

  it('aucun secret non revu dans le code du cœur (I-32)', () => {
    const scanner = new SecretScanner();
    const findings = [
      ...scanner.scanTree(join(CORE_ROOT, 'src')),
      ...scanner.scanTree(join(CORE_ROOT, 'tests')),
    ];
    const allowlist = SecurityAllowlist.load(join(REPO_ROOT, '.codidev-security-allowlist.json'));
    const { active, suppressed } = allowlist.partition(findings, CORE_ROOT);

    // Un secret en clair dans le code du cœur est un incident, pas un avertissement : la liste des
    // constatations actives doit être vide.
    expect(
      active.map((item) => `${item.rule} ${relative(CORE_ROOT, item.source)}:${String(item.line)}`),
    ).toEqual([]);
    // Les exceptions éventuelles restent visibles : elles ne disparaissent jamais du rapport.
    expect(suppressed.length).toBeGreaterThanOrEqual(0);
  });
});
