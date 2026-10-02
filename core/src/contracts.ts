/**
 * Chargement, indexation et validation des contrats du cœur.
 *
 * Les contrats sont des JSON Schema 2020-12 **neutres et partagés** (`core/schemas/`) : ils ne
 * dépendent d'aucune implémentation. La résolution des `$ref` est **hors ligne** — valider un
 * document ne dépend d'aucun accès réseau — et un test d'alignement vérifie que chaque
 * énumération de schéma correspond exactement au vocabulaire déclaré dans `statuses.ts`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Ajv as AjvInstance, ValidateFunction } from 'ajv';
// Les contrats sont en JSON Schema **2020-12** : le `Ajv` par défaut ne connaît que draft-07 et
// refuserait d'enregistrer ces schémas. On utilise explicitement la classe du dialecte 2020-12.
import Ajv2020Module from 'ajv/dist/2020.js';
import * as ajvFormatsModule from 'ajv-formats';

import { ContractError } from './errors.js';

/**
 * `ajv-formats` est publié en CommonJS (`module.exports = plugin`) tout en déclarant un export
 * par défaut dans ses types. Selon la façon dont l'interopérabilité est résolue, l'import par
 * défaut désigne tantôt le module, tantôt la fonction. On prend explicitement le champ `default`,
 * qui est la fonction dans les deux cas.
 */
const addFormats = (
  ajvFormatsModule as unknown as {
    default: (instance: AjvInstance, options?: unknown) => AjvInstance;
  }
).default;

/**
 * `ajv` est publié en CommonJS et déclare son export 2020-12 en `export =`, ce que la résolution
 * ESM expose comme un espace de noms. On rétablit explicitement la classe constructible, plutôt
 * que de désactiver le typage — un `any` ici masquerait toute erreur de configuration.
 */
const Ajv2020 = Ajv2020Module as unknown as new (options?: Record<string, unknown>) => AjvInstance;

/** Noms des contrats, triés. Toute évolution ici est un changement de contrat, donc revu. */
export const CONTRACT_NAMES = [
  'action',
  'approval',
  'audit_record',
  'context_bundle',
  'decision',
  'evidence',
  'intent',
  'plan',
  'policy_decision',
  'risk_class',
  'security_allowlist',
  'task',
  'tool_request',
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];

export const SCHEMA_BASE_URI = 'https://codidev.local/schemas/';

/**
 * Localise le répertoire des contrats en remontant l'arborescence depuis ce module.
 *
 * La remontée plutôt qu'un chemin fixe évite de dépendre de la profondeur de compilation
 * (`src/` en développement, `dist/` après construction) : le répertoire trouvé est le même.
 */
function findSchemaDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'schemas');
    if (existsSync(join(candidate, 'task.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ContractError('répertoire des contrats introuvable', {
    context: { searchedFrom: fileURLToPath(import.meta.url) },
  });
}

export const SCHEMA_DIR: string = findSchemaDir();

function assertKnown(name: string): ContractName {
  if (!(CONTRACT_NAMES as readonly string[]).includes(name)) {
    throw new ContractError(`contrat inconnu : ${name}`, {
      context: { available: [...CONTRACT_NAMES] },
    });
  }
  return name as ContractName;
}

/** Chemin du fichier de schéma d'un contrat. */
export function contractPath(name: ContractName): string {
  return join(SCHEMA_DIR, `${assertKnown(name)}.json`);
}

/** Noms des contrats réellement présents sur le disque. */
export function schemaFiles(): string[] {
  return readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

const schemaCache = new Map<ContractName, Record<string, unknown>>();

/** Charge le schéma JSON d'un contrat. */
export function loadSchema(name: ContractName): Record<string, unknown> {
  const known = assertKnown(name);
  const cached = schemaCache.get(known);
  if (cached !== undefined) return cached;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(contractPath(known), 'utf8'));
  } catch (error) {
    throw new ContractError(`schéma illisible : ${known}`, { context: { cause: String(error) } });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContractError(`schéma non-objet : ${known}`);
  }
  const schema = parsed as Record<string, unknown>;
  schemaCache.set(known, schema);
  return schema;
}

let ajvInstance: AjvInstance | undefined;

function ajv(): AjvInstance {
  if (ajvInstance !== undefined) return ajvInstance;
  const instance = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateSchema: true,
  });
  addFormats(instance);
  for (const name of CONTRACT_NAMES) {
    const schema = loadSchema(name);
    const id = typeof schema.$id === 'string' ? schema.$id : `${SCHEMA_BASE_URI}${name}.json`;
    instance.addSchema(schema, id);
  }
  ajvInstance = instance;
  return instance;
}

const validatorCache = new Map<ContractName, ValidateFunction>();

function validatorFor(name: ContractName): ValidateFunction {
  const known = assertKnown(name);
  const cached = validatorCache.get(known);
  if (cached !== undefined) return cached;
  const id = `${SCHEMA_BASE_URI}${known}.json`;
  const compiled = ajv().getSchema(id) ?? ajv().compile(loadSchema(known));
  validatorCache.set(known, compiled);
  return compiled;
}

/** Messages d'erreur lisibles pour un document, avec le chemin de la violation. */
export function iterErrors(name: ContractName, document: unknown): string[] {
  const validate = validatorFor(name);
  if (validate(document)) return [];
  return (validate.errors ?? []).map((error) => {
    const location = error.instancePath === '' ? '<racine>' : error.instancePath.replace(/^\//, '');
    const detail = error.message ?? 'violation';
    const extra = error.params === undefined ? '' : ` ${JSON.stringify(error.params)}`;
    return `${location}: ${detail}${extra}`;
  });
}

/** Valide un document contre un contrat et lève `ContractError` s'il est invalide. */
export function validate(name: ContractName, document: unknown): void {
  const violations = iterErrors(name, document);
  if (violations.length > 0) {
    throw new ContractError(`document non conforme au contrat ${name}`, {
      context: { contract: name, violations },
    });
  }
}

/** Vrai si le document satisfait le contrat. */
export function isValid(name: ContractName, document: unknown): boolean {
  return iterErrors(name, document).length === 0;
}

/**
 * Liste `enum` désignée par un pointeur JSON (`#/$defs/risk_class`) dans un schéma.
 * Sert aux tests d'alignement entre schémas et vocabulaires Typescript.
 */
export function schemaEnum(name: ContractName, pointer: string): string[] {
  let node: unknown = loadSchema(name);
  if (pointer.startsWith('#/')) {
    for (const part of pointer.slice(2).split('/')) {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) {
        throw new ContractError(`pointeur introuvable : ${pointer}`, {
          context: { contract: name },
        });
      }
      node = (node as Record<string, unknown>)[part];
      if (node === undefined) {
        throw new ContractError(`pointeur introuvable : ${pointer}`, {
          context: { contract: name },
        });
      }
    }
  }
  if (node === null || typeof node !== 'object' || !('enum' in node)) {
    throw new ContractError(`aucun \`enum\` au pointeur : ${pointer}`, {
      context: { contract: name },
    });
  }
  const values = (node as { enum: unknown }).enum;
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
    throw new ContractError(`\`enum\` non textuel : ${pointer}`, { context: { contract: name } });
  }
  return values as string[];
}
