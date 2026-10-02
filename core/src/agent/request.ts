/**
 * Demande entrante.
 *
 * Trois garanties à la construction :
 *
 *   - **tenant et acteur obligatoires** : une demande sans appartenance ni auteur est refusée. Sans
 *     tenant, l'isolation du contexte n'a plus de sens ; sans acteur, rien n'est imputable.
 *   - **texte caviardé** : une demande peut contenir un secret ; il est neutralisé avant que la
 *     demande n'entre dans le cycle, donc avant toute journalisation.
 *   - **signaux structurés séparés du texte** : l'intention se lit dans des signaux explicites, pas
 *     dans une interprétation libre du langage naturel. C'est ce qui permet au cœur de refuser de
 *     planifier plutôt que de deviner.
 */

import { CodiDevError } from '../errors.js';
import { newId, utcNowIso } from '../ids.js';
import { redact } from '../security/secrets.js';
import { OperationStatus } from '../statuses.js';

/** Demande mal formée : refusée avant toute analyse. */
export class RequestInvalidError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

export interface RequestInit {
  readonly text: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly requestId?: string;
  readonly createdAt?: string;
  readonly projectId?: string | null;
  /** Signaux structurés (ex. `action: fix`, `scope: module auth`). */
  readonly hints?: Readonly<Record<string, string>>;
}

/** Demande entrante, validée et caviardée. */
export class Request {
  readonly text: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly requestId: string;
  readonly createdAt: string;
  readonly projectId: string | null;
  readonly hints: Readonly<Record<string, string>>;

  constructor(init: RequestInit) {
    const tenantId = init.tenantId?.trim() ?? '';
    if (tenantId === '') {
      throw new RequestInvalidError('une demande sans tenant est refusée');
    }
    const actor = init.actor?.trim() ?? '';
    if (actor === '') {
      throw new RequestInvalidError('une demande sans acteur identifié est refusée');
    }
    const text = init.text ?? '';
    if (text.trim() === '') {
      throw new RequestInvalidError('une demande sans texte est refusée', {
        context: { tenantId },
      });
    }
    this.tenantId = tenantId;
    this.actor = actor;
    this.text = redact(text);
    this.requestId = init.requestId ?? newId('req');
    this.createdAt = init.createdAt ?? utcNowIso();
    this.projectId = init.projectId ?? null;
    this.hints = { ...(init.hints ?? {}) };
  }

  /** Valeur d'un signal structuré, ou `undefined`. */
  hint(key: string): string | undefined {
    const value = this.hints[key];
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  toJson(): Record<string, unknown> {
    return {
      request_id: this.requestId,
      tenant_id: this.tenantId,
      actor: this.actor,
      text: this.text,
      project_id: this.projectId,
      hints: { ...this.hints },
      created_at: this.createdAt,
    };
  }
}
