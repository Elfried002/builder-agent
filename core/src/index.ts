/**
 * Surface publique du paquet `@codidev/core`.
 *
 * `CodiDevCore` est le point d'entrée d'intégration : il assemble les briques (contexte, plan,
 * décision, tâche, preuves, audit, provider LLM) et expose un cycle unique. C'est une **API
 * logicielle interne au paquet** — pas un service, pas un endpoint, aucune couche HTTP.
 *
 *     import { CodiDevCore } from '@codidev/core';
 *
 *     const core = CodiDevCore.create({
 *       workspaceDir: './.codidev',
 *       env: process.env,        // la clé d'API vit ici, jamais dans le code
 *     });
 *     const result = await core.run({
 *       text: 'corriger la validation des entrées',
 *       tenantId: 'tenant-a',
 *       actor: 'user-1',
 *       hints: { action: 'fix' },
 *     });
 *
 * Aucune brique n'est construite en dur : tout est injectable, donc testable et remplaçable.
 */

import { join } from 'node:path';
import { AgentCore, type RunOptions, type RunResult } from './agent/core.js';
import { Request, type RequestInit } from './agent/request.js';
import { AuditLedger } from './audit.js';
import { ContextEngine } from './context/engine.js';
import { DecisionEngine } from './decision/engine.js';
import { EvidenceStore } from './evidence.js';
import { DeepSeekProvider } from './llm/deepseek.js';
import { MockLLMProvider, type MockStep } from './llm/mock.js';
import {
  type LLMConfig,
  type LLMProvider,
  LLMProviderName,
  loadLLMConfigFromEnv,
} from './llm/types.js';

export const EVIDENCE_FILENAME = 'evidence.jsonl';
export const AUDIT_FILENAME = 'audit.jsonl';

export interface CodiDevCoreConfig {
  /** Répertoire des journaux du cœur (`evidence.jsonl`, `audit.jsonl`). */
  readonly workspaceDir: string;
  /** Environnement d'exécution ; c'est là que réside la clé d'API du provider. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Configuration LLM explicite, prioritaire sur l'environnement. `null` désactive le LLM. */
  readonly llm?: LLMConfig | null;
  /** Scénario du provider simulé, lorsque `provider: 'mock'` est retenu. */
  readonly mockSteps?: readonly MockStep[];
  readonly defaultActor?: string;
}

/** Environnement d'exécution du cœur : briques assemblées, journaux ouverts, provider prêt. */
export class CodiDevCore {
  readonly evidence: EvidenceStore;
  readonly audit: AuditLedger;
  readonly agent: AgentCore;
  readonly llm: LLMProvider | null;
  readonly workspaceDir: string;

  constructor(config: CodiDevCoreConfig) {
    this.workspaceDir = config.workspaceDir;
    const env = config.env ?? process.env;
    this.evidence = new EvidenceStore(join(config.workspaceDir, EVIDENCE_FILENAME));
    this.audit = new AuditLedger(join(config.workspaceDir, AUDIT_FILENAME));

    const llmConfig = config.llm === null ? null : (config.llm ?? loadLLMConfigFromEnv(env));
    if (llmConfig === null) {
      this.llm = null;
    } else if (llmConfig.provider === LLMProviderName.Mock) {
      this.llm = new MockLLMProvider({
        steps: config.mockSteps ?? [],
        model: llmConfig.model,
        repeatLast: true,
      });
    } else {
      this.llm = new DeepSeekProvider(llmConfig, { env });
    }

    this.agent = new AgentCore({
      decisionEngine: new DecisionEngine(),
      contextEngine: new ContextEngine(),
      evidence: this.evidence,
      audit: this.audit,
      ...(this.llm === null ? {} : { llm: this.llm }),
      ...(config.defaultActor === undefined ? {} : { defaultActor: config.defaultActor }),
    });
  }

  /** Fabrique : même chose que le constructeur, en laissant la place à une configuration asynchrone. */
  static create(config: CodiDevCoreConfig): CodiDevCore {
    return new CodiDevCore(config);
  }

  /**
   * Cycle complet sur une demande.
   *
   * Le tenant et l'acteur sont **obligatoires** : une demande sans appartenance ni auteur est
   * refusée avant toute analyse.
   */
  async run(init: RequestInit | Request, options: RunOptions = {}): Promise<RunResult> {
    const request = init instanceof Request ? init : new Request(init);
    return this.agent.run(request, options);
  }

  /**
   * Intégrité des journaux : toute altération d'une preuve ou d'une action d'audit est détectée.
   * À vérifier avant d'affirmer qu'une opération a bien eu lieu.
   */
  async integrity(): Promise<{
    evidence: Awaited<ReturnType<EvidenceStore['verify']>>;
    audit: Awaited<ReturnType<AuditLedger['verify']>>;
  }> {
    return { evidence: await this.evidence.verify(), audit: await this.audit.verify() };
  }
}

export * from './agent/index.js';
export { AuditLedger } from './audit.js';
// Moteurs.
export * from './context/engine.js';
export type { ContractName } from './contracts.js';

// Contrats et primitives de journalisation.
export {
  CONTRACT_NAMES,
  contractPath,
  isValid,
  iterErrors,
  loadSchema,
  SCHEMA_DIR,
  schemaEnum,
  schemaFiles,
  validate,
} from './contracts.js';
export * from './decision/engine.js';
export * from './errors.js';
export { EvidenceStore, ValidationOutcome } from './evidence.js';
export { canonicalJson, chainedHash, digest, GENESIS_HASH, sha256Hex } from './hashing.js';
export { newId, utcNowIso } from './ids.js';
export type {
  IntegrityIssue,
  IntegrityIssueCode,
  IntegrityReport,
  JournalSink,
} from './journal.js';
export { ChainedJournal, FileJournalSink, integrityReportToJson } from './journal.js';
// Couche LLM.
export * from './llm/index.js';
export * from './planner/planner.js';
// Sécurité.
export * from './security/index.js';
// Vocabulaires et erreurs : nécessaires à l'appelant pour interpréter un résultat.
export * from './statuses.js';
export * from './task/engine.js';
export type { RequestInit, RunOptions, RunResult };
export { AgentCore, Request };
