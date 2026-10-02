/**
 * Gestionnaire de route Next.js (App Router) : `POST /api/codidev`.
 *
 * POURQUOI ce fichier est le seul élément propre à Next.js :
 * ce qui fait de lui une route, c'est **son emplacement** (`app/api/codidev/route.ts`) et le nom
 * de l'export attendu (`POST`). Le corps, lui, n'importe rien de `next/server` : il n'utilise que
 * les types standards `Request` et `Response` du Web API, exposés globalement par @types/node.
 * C'est délibéré — le fichier reste ainsi **réellement vérifié par `tsc`** sans installer Next.js,
 * et il serait transposable tel quel à un autre routeur Web standard.
 *
 * POURQUOI la clé n'apparaît nulle part ici :
 * l'appelant envoie une demande métier ; le serveur lit sa configuration (nom de la variable de
 * clé, provider, modèle) dans `process.env`, via `runCodidev`. Aucun secret ne transite par le
 * corps de la requête HTTP et aucun n'est renvoyé dans la réponse.
 */

import { runCodidev } from '../../../runCodidev.js';

/** Réponse JSON minimale, sans dépendance à un helper de framework. */
function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Garde de forme : on refuse tout ce qui n'est pas un objet JSON, sans supposer sa structure. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Chaîne non vide requise, `null` sinon : une valeur vide est traitée comme absente. */
function readRequiredString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Chaîne non vide facultative ; renvoie `undefined` pour ne jamais propager `null`. */
function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = readRequiredString(source, key);
  return value === null ? undefined : value;
}

/** Signaux structurés : seules les valeurs textuelles sont retenues, le reste est ignoré. */
function readHints(source: Record<string, unknown>): Readonly<Record<string, string>> | undefined {
  const raw = source.hints;
  if (!isRecord(raw)) return undefined;
  const hints: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') hints[key] = value;
  }
  return Object.keys(hints).length === 0 ? undefined : hints;
}

/**
 * Point d'entrée HTTP.
 *
 * Une demande incomplète est refusée **avant** d'atteindre le cœur : le cœur exige un tenant et un
 * acteur, et renvoyer 400 ici évite de journaliser une demande qui n'aurait pas de sens.
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'corps JSON illisible' }, 400);
  }
  if (!isRecord(payload)) {
    return jsonResponse({ error: 'un objet JSON est attendu' }, 400);
  }

  const text = readRequiredString(payload, 'text');
  const tenantId = readRequiredString(payload, 'tenantId');
  const actor = readRequiredString(payload, 'actor');
  if (text === null || tenantId === null || actor === null) {
    return jsonResponse({ error: 'les champs text, tenantId et actor sont obligatoires' }, 400);
  }

  const projectId = readOptionalString(payload, 'projectId');
  const hints = readHints(payload);

  try {
    // Le cycle reste une proposition : le cœur ne prétendra jamais avoir exécuté ce travail.
    const summary = await runCodidev({
      text,
      tenantId,
      actor,
      ...(projectId === undefined ? {} : { projectId }),
      ...(hints === undefined ? {} : { hints }),
      useLlmForPlan: true,
    });
    return jsonResponse(summary, 200);
  } catch (error) {
    // Un échec du cœur n'est jamais converti en succès : on renvoie le motif tel quel.
    const message = error instanceof Error ? error.message : 'erreur inconnue';
    return jsonResponse({ error: message }, 500);
  }
}
