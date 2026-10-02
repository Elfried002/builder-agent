/**
 * Compréhension structurée d'une demande.
 *
 * L'intention est un **artefact exposable** : elle énonce ce qui a été compris, ce qui reste
 * incertain et ce qui doit être clarifié. Elle n'est jamais un raisonnement privé.
 *
 * Deux chemins, dans cet ordre :
 *
 * 1. **Signaux explicites** (déterministe). Un signal reconnu fixe la catégorie avec une confiance
 *    de 1 : elle a été donnée, pas devinée.
 * 2. **Classification assistée par le LLM**, uniquement si aucun signal n'est présent. La réponse
 *    du modèle est **validée par le cœur** : catégorie parmi les neuf connues, confiance numérique
 *    bornée. Une réponse inutilisable ne devient jamais une intention — elle laisse la demande
 *    indéterminée, et le cœur posera une question ouverte au lieu de planifier.
 *
 * La confiance d'une intention inférée est plafonnée : une déduction n'est jamais présentée avec
 * la même autorité qu'un signal explicite.
 */

import { validate } from '../contracts.js';
import { newId, utcNowIso } from '../ids.js';
import type { LLMProvider } from '../llm/types.js';
import { LLMRole } from '../llm/types.js';
import { redact } from '../security/secrets.js';
import type { Request } from './request.js';

/** Nature du travail demandé. */
export const IntentCategory = {
  CreateSoftware: 'CREATE_SOFTWARE',
  ModifySoftware: 'MODIFY_SOFTWARE',
  Analyze: 'ANALYZE',
  Fix: 'FIX',
  Secure: 'SECURE',
  Test: 'TEST',
  Deploy: 'DEPLOY',
  Document: 'DOCUMENT',
  Unknown: 'UNKNOWN',
} as const;
export type IntentCategory = (typeof IntentCategory)[keyof typeof IntentCategory];

export const INTENT_CATEGORIES: readonly IntentCategory[] = Object.values(IntentCategory);

/** Confiance maximale accordée à une intention déduite par un modèle. */
export const MAX_INFERRED_CONFIDENCE = 0.7;

/** Question posée lorsque rien ne permet de déterminer le travail demandé. */
export const QUESTION_SANS_SIGNAL =
  "Aucune intention exploitable n'a été établie : précisez le travail attendu " +
  '(par exemple créer, modifier, analyser, corriger, sécuriser, tester, déployer ou documenter), ' +
  'ou fournissez un signal structuré. Le cœur ne planifie pas sur une supposition.';

/** Signal structuré → catégorie. Les valeurs sont normalisées en minuscules. */
export const SIGNAL_CATEGORIES: Readonly<Record<string, IntentCategory>> = {
  create: IntentCategory.CreateSoftware,
  create_software: IntentCategory.CreateSoftware,
  modify: IntentCategory.ModifySoftware,
  modify_software: IntentCategory.ModifySoftware,
  analyze: IntentCategory.Analyze,
  analyse: IntentCategory.Analyze,
  fix: IntentCategory.Fix,
  secure: IntentCategory.Secure,
  test: IntentCategory.Test,
  deploy: IntentCategory.Deploy,
  document: IntentCategory.Document,
};

export interface IntentRecordInit {
  readonly statement: string;
  readonly category: IntentCategory;
  readonly confidence: number;
  readonly constraints?: readonly string[];
  readonly sources?: readonly string[];
  readonly openQuestions?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
  readonly requestId?: string | null;
  readonly intentId?: string;
  readonly createdAt?: string;
}

/** Intention structurée, conforme au contrat `intent`. */
export class IntentRecord {
  readonly intentId: string;
  readonly statement: string;
  readonly category: IntentCategory;
  readonly confidence: number;
  readonly constraints: readonly string[];
  readonly sources: readonly string[];
  readonly openQuestions: readonly string[];
  readonly assumptions: readonly string[];
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;

  constructor(init: IntentRecordInit) {
    if (!Number.isFinite(init.confidence) || init.confidence < 0 || init.confidence > 1) {
      throw new RangeError(`confiance hors bornes : ${String(init.confidence)}`);
    }
    this.intentId = init.intentId ?? newId('intent');
    this.statement = redact(init.statement);
    this.category = init.category;
    this.confidence = init.confidence;
    this.constraints = [...(init.constraints ?? [])];
    this.sources = [...(init.sources ?? [])];
    this.openQuestions = [...(init.openQuestions ?? [])];
    this.assumptions = [...(init.assumptions ?? [])];
    this.tenantId = init.tenantId ?? null;
    this.projectId = init.projectId ?? null;
    this.requestId = init.requestId ?? null;
    this.createdAt = init.createdAt ?? utcNowIso();
    validate('intent', this.toJson());
  }

  /** Une intention n'est déterminée que si une catégorie réelle a été établie. */
  get isDetermined(): boolean {
    return this.category !== IntentCategory.Unknown;
  }

  toJson(): Record<string, unknown> {
    return {
      intent_id: this.intentId,
      statement: this.statement,
      category: this.category,
      confidence: this.confidence,
      constraints: [...this.constraints],
      sources: [...this.sources],
      open_questions: [...this.openQuestions],
      assumptions: [...this.assumptions],
      tenant_id: this.tenantId,
      project_id: this.projectId,
      request_id: this.requestId,
      created_at: this.createdAt,
    };
  }
}

/** Schéma de la sortie attendue du modèle pour la classification. */
export const INTENT_CLASSIFICATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence'],
  properties: {
    category: { type: 'string', enum: [...INTENT_CATEGORIES] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    statement: { type: 'string' },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT =
  'Tu classes une demande de travail logiciel. Tu réponds uniquement par un objet JSON conforme ' +
  'au schéma fourni. Tu ne proposes aucune action, aucun outil, aucune commande : tu classes.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Analyse déterministe : lit les signaux structurés, jamais le texte libre.
 * Aucun signal reconnu ⇒ intention `UNKNOWN`, confiance 0, question ouverte.
 */
export function analyzeSignals(request: Request): IntentRecord {
  const signal = (request.hint('action') ?? request.hint('intent') ?? '').toLowerCase();
  const category = SIGNAL_CATEGORIES[signal];
  if (category === undefined) {
    return new IntentRecord({
      statement: request.text,
      category: IntentCategory.Unknown,
      confidence: 0,
      openQuestions: [QUESTION_SANS_SIGNAL],
      sources: [`request:${request.requestId}`],
      tenantId: request.tenantId,
      projectId: request.projectId,
      requestId: request.requestId,
    });
  }
  const constraints: string[] = [];
  const scope = request.hint('scope');
  if (scope !== undefined) constraints.push(`périmètre : ${scope}`);
  return new IntentRecord({
    statement: request.text,
    category,
    confidence: 1,
    constraints,
    sources: [`request:${request.requestId}`, `signal:action=${signal}`],
    tenantId: request.tenantId,
    projectId: request.projectId,
    requestId: request.requestId,
  });
}

/**
 * Classification assistée par le LLM, **validée par le cœur**.
 *
 * Le modèle ne fixe ni le tenant, ni l'acteur, ni la confiance : il propose une catégorie. Toute
 * réponse hors du vocabulaire connu, non numérique ou incohérente laisse la demande indéterminée —
 * le cœur préfère une question ouverte à une intention inventée.
 */
export async function classifyWithLLM(
  request: Request,
  llm: LLMProvider,
  contextText?: string,
): Promise<IntentRecord> {
  const indetermined = (reason: string): IntentRecord =>
    new IntentRecord({
      statement: request.text,
      category: IntentCategory.Unknown,
      confidence: 0,
      openQuestions: [QUESTION_SANS_SIGNAL],
      sources: [`request:${request.requestId}`, reason],
      tenantId: request.tenantId,
      projectId: request.projectId,
      requestId: request.requestId,
    });

  const response = await llm.generate({
    requestId: request.requestId,
    system: SYSTEM_PROMPT,
    ...(contextText === undefined ? {} : { context: contextText }),
    messages: [{ role: LLMRole.User, content: request.text }],
    structuredSchema: INTENT_CLASSIFICATION_SCHEMA,
    temperature: 0,
  });

  const payload = response.structured;
  if (!isRecord(payload)) return indetermined('intent:classification-illisible');

  const category = payload.category;
  if (
    typeof category !== 'string' ||
    !(INTENT_CATEGORIES as readonly string[]).includes(category)
  ) {
    return indetermined('intent:categorie-hors-vocabulaire');
  }
  if (category === IntentCategory.Unknown) return indetermined('intent:modele-indetermine');

  const rawConfidence = payload.confidence;
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    return indetermined('intent:confiance-non-numerique');
  }

  const questions = Array.isArray(payload.open_questions)
    ? payload.open_questions.filter((item): item is string => typeof item === 'string')
    : [];
  const statement =
    typeof payload.statement === 'string' && payload.statement.trim() !== ''
      ? payload.statement
      : request.text;

  return new IntentRecord({
    statement,
    category: category as IntentCategory,
    // Inférée, donc plafonnée : une déduction n'a jamais l'autorité d'un signal explicite.
    confidence: Math.min(Math.abs(rawConfidence), MAX_INFERRED_CONFIDENCE),
    sources: [
      `request:${request.requestId}`,
      `llm:${response.provider}/${response.model}`,
      `llm:response=${response.responseId}`,
    ],
    openQuestions: questions,
    tenantId: request.tenantId,
    projectId: request.projectId,
    requestId: request.requestId,
  });
}
