/**
 * Détection et caviardage de secrets.
 *
 * Deux usages, une seule source de règles :
 *
 * 1. **Scan** — `SecretScanner` cherche des secrets dans un texte, un fichier ou une arborescence.
 * 2. **Caviardage** — `redact` / `redactStructure` neutralisent les secrets avant qu'ils n'entrent
 *    dans une preuve, un journal d'audit ou une sortie console.
 *
 * Deux propriétés sont tenues par construction et vérifiées par des tests :
 *
 *   - **Le caviardage ne peut pas franchir une frontière de code.** L'heuristique d'affectation
 *     n'accepte pas de séparateur de chemin ni d'accès d'attribut : sans cette contrainte, une
 *     ligne comme `token = req.headers.authorization` serait signalée comme un secret.
 *   - **Le caviardage est idempotent.** Un texte déjà caviardé ne doit plus rien déclencher, sinon
 *     tout rapport citant une constatation se re-signalerait à chaque relecture, et le compteur
 *     ne redescendrait jamais à zéro.
 *
 * Portage de `core/python/src/codidev/security/secrets.py`. Les expressions régulières ont été
 * transposées une par une : JavaScript n'a ni les mêmes classes de caractères ni le même
 * traitement Unicode que Python, une traduction approximative aurait donc silencieusement changé
 * ce qui est détecté.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Severity } from '../statuses.js';
import type { Finding } from './report.js';

/** Marque de caviardage. Conserve le fait qu'un secret a été vu, jamais sa valeur. */
export function redactionMark(rule: string): string {
  return `[REDACTED:${rule}]`;
}

/**
 * Jeton présent dans un caviardage. Un texte déjà caviardé n'est jamais un secret : sans cette
 * garde, un rapport serait re-détecté à chaque republication.
 */
export const REDACTION_TOKEN = 'REDACTED';

/** Valeurs explicitement inoffensives : jamais signalées. */
export const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  'changeme',
  'change_me',
  'example',
  'examples',
  'placeholder',
  'redacted',
  'none',
  'null',
  'true',
  'false',
  'your_token_here',
  'your-token-here',
  'xxx',
  'todo',
  'fixme',
  'test',
  'dummy',
  'sample',
  'local',
  'dev',
  'development',
  'test-token',
]);

/** Valeurs de mot de passe manifestement factices, masquées ou d'exemple. */
export const PLACEHOLDER_PASSWORDS: ReadonlySet<string> = new Set([
  '***',
  '...',
  'xxx',
  'xxxx',
  'secret',
  'changeme',
  'change_me',
  'password',
  'passwd',
  'pass',
  'postgres',
  'mysql',
  'mariadb',
  'mongo',
  'mongodb',
  'redis',
  'root',
  'admin',
  'user',
  'username',
  'db',
  'database',
  'app',
  'demo',
  'dev',
  'local',
  'test',
  'example',
]);

/** Seuil d'entropie en dessous duquel une valeur n'est pas un secret plausible. */
export const MIN_VALUE_ENTROPY = 2.5;

export interface SecretRule {
  readonly name: string;
  /** Expression régulière portant au moins les drapeaux `g` (itération) et `d` (positions). */
  readonly pattern: RegExp;
  readonly severity: Severity;
  readonly description: string;
  /** Nom du groupe à caviarder ; sans lui, la correspondance entière est caviardée. */
  readonly valueGroup?: string;
  /** Filtre appliqué à la valeur capturée : écarte les non-valeurs avant tout signalement. */
  readonly valueFilter?: (value: string) => boolean;
}

/** Entropie de Shannon (bits par caractère) d'une chaîne. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

/** Vrai si la valeur est déjà un caviardage produit par le cœur. */
export function containsRedactionMarker(value: string): boolean {
  return value.toUpperCase().includes(REDACTION_TOKEN);
}

function strip(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, '');
}

/** Écarte les valeurs manifestement inoffensives ou trop peu entropiques. */
export function isPlausibleSecret(value: string): boolean {
  const candidate = strip(value);
  if (candidate.length === 0) return false;
  if (PLACEHOLDER_VALUES.has(candidate.toLowerCase())) return false;
  if (containsRedactionMarker(candidate)) return false;
  if (new Set(candidate).size <= 2) return false;
  return shannonEntropy(candidate) >= MIN_VALUE_ENTROPY;
}

/**
 * Filtre de l'heuristique d'affectation : distingue un littéral secret d'une expression de code.
 *
 * Les formats réels (jetons GitHub, clés AWS, JWT…) sont couverts par leurs règles dédiées :
 * cette heuristique ne doit pas crier sur du code légitime, sinon elle sera désactivée.
 */
export function looksLikeLiteralSecret(value: string): boolean {
  const candidate = strip(value);
  if (!isPlausibleSecret(candidate)) return false;
  if (/[._/+]/.test(candidate)) return false;
  const isSingleCaseLetters = /^[a-z]+$/.test(candidate) || /^[A-Z]+$/.test(candidate);
  if (isSingleCaseLetters) return false;
  return shannonEntropy(candidate) >= 3;
}

/**
 * Filtre des mots de passe d'URL.
 *
 * Écarte les valeurs masquées (`***`), les mots de passe d'exemple, et les gabarits
 * d'interpolation (`{mot_de_passe}`, `${DB_PASSWORD}`, `<password>`) : ce ne sont pas des valeurs,
 * ce sont des emplacements.
 */
export function looksLikePassword(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length === 0) return false;
  if (PLACEHOLDER_PASSWORDS.has(candidate.toLowerCase())) return false;
  if (containsRedactionMarker(candidate)) return false;
  if ([...new Set(candidate)].every((char) => char === '*' || char === '.')) return false;
  if (PLACEHOLDER_VALUES.has(candidate.toLowerCase())) return false;
  if (/[{}<>$%]/.test(candidate)) return false;
  return candidate.length >= 4;
}

/** Règles de détection. Toute évolution ici est un changement de comportement, donc testé. */
export const DEFAULT_RULES: readonly SecretRule[] = [
  {
    name: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/dg,
    severity: Severity.Critical,
    description: 'Bloc de clé privée en clair.',
  },
  {
    name: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/dg,
    severity: Severity.Critical,
    description: "Identifiant de clé d'accès AWS.",
  },
  {
    name: 'aws-secret-access-key',
    pattern: /\baws_?secret_?access_?key\b\s*[:=]\s*["']?(?<value>[A-Za-z0-9/+=]{40})["']?/dgi,
    severity: Severity.Critical,
    description: "Clé d'accès secrète AWS.",
    valueGroup: 'value',
  },
  {
    name: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/dg,
    severity: Severity.Critical,
    description: 'Jeton GitHub classique.',
  },
  {
    name: 'github-fine-grained-token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/dg,
    severity: Severity.Critical,
    description: 'Jeton GitHub à permissions fines.',
  },
  {
    name: 'openai-key',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/dg,
    severity: Severity.Critical,
    description: "Clé d'API de type OpenAI.",
  },
  {
    name: 'anthropic-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/dg,
    severity: Severity.Critical,
    description: "Clé d'API Anthropic.",
  },
  {
    name: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/dg,
    severity: Severity.Critical,
    description: "Clé d'API Google.",
  },
  {
    name: 'slack-token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/dg,
    severity: Severity.Critical,
    description: 'Jeton Slack.',
  },
  {
    name: 'slack-webhook',
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/dg,
    severity: Severity.High,
    description: "URL de webhook Slack (secret d'écriture).",
  },
  {
    name: 'stripe-key',
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/dg,
    severity: Severity.Critical,
    description: "Clé d'API Stripe.",
  },
  {
    name: 'supabase-service-key',
    pattern: /\bsbp_[A-Za-z0-9]{20,}\b/dg,
    severity: Severity.Critical,
    description: 'Jeton Supabase.',
  },
  {
    name: 'database-url-with-credentials',
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^:@\s/]+:(?<value>[^@\s/]{3,})@/dgi,
    severity: Severity.Critical,
    description: 'URL de connexion contenant un mot de passe en clair.',
    valueGroup: 'value',
    valueFilter: looksLikePassword,
  },
  {
    name: 'json-web-token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/dg,
    severity: Severity.High,
    description: 'JWT en clair.',
  },
  {
    name: 'bearer-token',
    pattern: /\bBearer\s+(?<value>[A-Za-z0-9._~+/=-]{24,})/dgi,
    severity: Severity.High,
    description: 'Jeton porteur en clair.',
    valueGroup: 'value',
  },
  {
    name: 'assigned-secret-value',
    pattern:
      /(?<name>[A-Za-z0-9_.-]{0,64}(?:secret|token|password|passwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]{0,64})\s*[:=]\s*["']?(?<value>[A-Za-z0-9_-]{16,})["']?/dgi,
    severity: Severity.High,
    description: "Affectation d'une valeur à un nom évoquant un secret.",
    valueGroup: 'value',
    valueFilter: looksLikeLiteralSecret,
  },
];

/** Répertoires jamais parcourus lors d'un scan d'arborescence. */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn',
  '.venv',
  'venv',
  'node_modules',
  '__pycache__',
  '.mypy_cache',
  '.ruff_cache',
  '.pytest_cache',
  '.vitest',
  'dist',
  'build',
  '.tox',
  '.eggs',
]);

/** Extensions binaires ou volumineuses, ignorées : un scan de secrets porte sur du texte. */
export const DEFAULT_SKIP_SUFFIXES: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.whl',
  '.so',
  '.dylib',
  '.dll',
  '.bin',
  '.exe',
  '.pyc',
  '.pyo',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.webm',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.lock',
]);

export const MAX_SCAN_BYTES = 2 * 1024 * 1024;

interface MatchSpan {
  readonly start: number;
  readonly end: number;
}

/** Détermine la portion d'une correspondance à caviarder : la valeur capturée, ou le tout. */
function valueSpan(match: RegExpMatchArray, rule: SecretRule): MatchSpan | null {
  const whole = { start: match.index ?? 0, end: (match.index ?? 0) + match[0].length };
  if (rule.valueGroup === undefined) return whole;
  const spans = match.indices;
  const groupSpan = spans?.groups?.[rule.valueGroup];
  if (groupSpan === undefined) return whole;
  return { start: groupSpan[0], end: groupSpan[1] };
}

function excerptOf(line: string, match: RegExpMatchArray, rule: SecretRule): string {
  const span = valueSpan(match, rule);
  if (span === null) return line.trim().slice(0, 400);
  const redacted = `${line.slice(0, span.start)}${redactionMark(rule.name)}${line.slice(span.end)}`;
  return redacted.trim().slice(0, 400);
}

/** Scanner de secrets à règles fixes, sans dépendance externe ni accès réseau. */
export class SecretScanner {
  readonly rules: readonly SecretRule[];
  readonly maxLineLength: number;

  constructor(rules: readonly SecretRule[] = DEFAULT_RULES, maxLineLength = 4000) {
    this.rules = rules;
    this.maxLineLength = maxLineLength;
  }

  /** Scanne un texte : constatations situées (ligne, colonne, extrait caviardé). */
  scanText(text: string, source: string): Finding[] {
    const findings: Finding[] = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (const [index, line] of lines.entries()) {
      if (line.length === 0 || line.length > this.maxLineLength) continue;
      for (const rule of this.rules) {
        // Une expression globale est *stateful* (`lastIndex`). On repart explicitement de zéro :
        // une correspondance manquée serait un secret non détecté, pas une simple imprécision.
        rule.pattern.lastIndex = 0;
        for (const match of line.matchAll(rule.pattern)) {
          if (rule.valueGroup !== undefined) {
            const values = match.groups ?? {};
            const candidate = values[rule.valueGroup] ?? '';
            if (rule.valueFilter !== undefined && !rule.valueFilter(candidate)) continue;
          }
          const span = valueSpan(match, rule);
          findings.push({
            rule: rule.name,
            severity: rule.severity,
            source,
            line: index + 1,
            column: (span?.start ?? 0) + 1,
            message: rule.description,
            excerpt: excerptOf(line, match, rule),
          });
        }
      }
    }
    return findings;
  }

  /** Scanne un fichier texte ; renvoie une liste vide pour un binaire ou un fichier illisible. */
  scanFile(path: string): Finding[] {
    let text: string;
    try {
      if (statSync(path).size > MAX_SCAN_BYTES) return [];
      text = readFileSync(path, 'utf8');
    } catch {
      return [];
    }
    return this.scanText(text, path);
  }

  /** Scanne récursivement une arborescence, en ignorant les répertoires et binaires connus. */
  scanTree(root: string): Finding[] {
    const findings: Finding[] = [];
    for (const file of iterFiles(root)) {
      findings.push(...this.scanFile(file));
    }
    return findings;
  }
}

/** Itère les fichiers texte candidats d'une arborescence, de façon déterministe et triée. */
export function iterFiles(
  root: string,
  skipDirs: ReadonlySet<string> = DEFAULT_SKIP_DIRS,
  skipSuffixes: ReadonlySet<string> = DEFAULT_SKIP_SUFFIXES,
): string[] {
  let isFile = false;
  try {
    isFile = statSync(root).isFile();
  } catch {
    return [];
  }
  if (isFile) return [root];

  const collected: string[] = [];
  const walk = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(directory, entry);
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const dot = entry.lastIndexOf('.');
      const suffix = dot === -1 ? '' : entry.slice(dot).toLowerCase();
      if (skipSuffixes.has(suffix)) continue;
      collected.push(full);
    }
  };
  walk(root);
  return collected;
}

/** Remplace la portion désignée d'une correspondance par la marque de caviardage. */
function redactMatch(match: RegExpMatchArray, rule: SecretRule): string {
  const span = valueSpan(match, rule);
  if (rule.valueGroup !== undefined && rule.valueFilter !== undefined) {
    const candidate = (match.groups ?? {})[rule.valueGroup] ?? '';
    if (!rule.valueFilter(candidate)) return match[0];
  }
  if (span === null) return redactionMark(rule.name);
  const offset = match.index ?? 0;
  return `${match[0].slice(0, span.start - offset)}${redactionMark(rule.name)}${match[0].slice(
    span.end - offset,
  )}`;
}

/** Caviarde tous les secrets détectés dans un texte. */
export function redact(text: string, rules: readonly SecretRule[] = DEFAULT_RULES): string {
  let result = text;
  for (const rule of rules) {
    // Attention : `.test()` sur une expression globale avance `lastIndex`, ce qui ferait démarrer
    // `matchAll` au milieu de la chaîne et manquerait les correspondances précédentes. On itère
    // donc directement les correspondances, sans pré-test.
    rule.pattern.lastIndex = 0;
    const matches = [...result.matchAll(rule.pattern)];
    if (matches.length === 0) continue;
    let rebuilt = '';
    let cursor = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      if (start < cursor) continue;
      rebuilt += result.slice(cursor, start);
      rebuilt += redactMatch(match, rule);
      cursor = start + match[0].length;
    }
    rebuilt += result.slice(cursor);
    result = rebuilt;
  }
  return result;
}

/** Caviarde récursivement toutes les chaînes d'une structure JSON-compatible. */
export function redactStructure(
  value: unknown,
  rules: readonly SecretRule[] = DEFAULT_RULES,
): unknown {
  if (typeof value === 'string') return redact(value, rules);
  if (Array.isArray(value)) return value.map((item) => redactStructure(item, rules));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = redactStructure(item, rules);
    }
    return result;
  }
  return value;
}
