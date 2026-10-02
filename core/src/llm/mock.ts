/**
 * Provider LLM simulé.
 *
 * Il existe pour une raison précise : **aucun test ne doit dépendre d'une clé d'API ni d'un accès
 * réseau**. Un test qui appelle réellement un fournisseur est un test qui échoue hors ligne,
 * coûte de l'argent et ne prouve rien de reproductible.
 *
 * Il enregistre les demandes reçues : les tests vérifient ainsi non seulement ce que le cœur fait
 * de la réponse, mais aussi ce qu'il a **transmis** au modèle — notamment qu'aucune clé ne figure
 * dans les messages.
 */

import { LLMProviderError } from '../errors.js';
import { newId } from '../ids.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMUsage,
} from './types.js';

/** Réponse scriptée, jouée dans l'ordre des appels. */
export interface MockStep {
  readonly text?: string;
  readonly structured?: unknown;
  readonly toolCalls?: readonly LLMToolCall[];
  readonly finishReason?: string;
  readonly usage?: Partial<LLMUsage>;
  /** Si renseigné, l'appel échoue avec ce message — pour tester la gestion d'erreur. */
  readonly error?: string;
}

export interface MockLLMProviderOptions {
  readonly steps: readonly MockStep[];
  readonly name?: string;
  readonly model?: string;
  readonly latencyMs?: number;
  /** Rejoue la dernière étape au-delà du scénario, au lieu d'échouer. */
  readonly repeatLast?: boolean;
}

/** Provider déterministe, sans réseau, piloté par un scénario. */
export class MockLLMProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private readonly steps: readonly MockStep[];
  private readonly latencyMs: number;
  private readonly received: LLMRequest[] = [];
  private readonly repeatLast: boolean;
  private cursor = 0;

  constructor(options: MockLLMProviderOptions) {
    this.name = options.name ?? 'mock';
    this.model = options.model ?? 'mock-model';
    this.steps = options.steps;
    this.latencyMs = options.latencyMs ?? 0;
    this.repeatLast = options.repeatLast ?? false;
  }

  /** Demandes réellement reçues, dans l'ordre : base des assertions sur ce qui a été transmis. */
  get calls(): readonly LLMRequest[] {
    return this.received;
  }

  /** Dernière demande reçue. */
  get lastCall(): LLMRequest | undefined {
    return this.received.at(-1);
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    this.received.push(request);
    const step = this.steps[this.cursor] ?? (this.repeatLast ? this.steps.at(-1) : undefined);
    this.cursor += 1;
    if (step === undefined) {
      throw new LLMProviderError(
        `aucune réponse scriptée disponible pour l'appel ${request.requestId}`,
        { context: { provider: this.name, step: this.cursor } },
      );
    }
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (step.error !== undefined) {
      throw new LLMProviderError(step.error, { context: { provider: this.name } });
    }
    const promptTokens = request.messages.reduce(
      (total, message: LLMMessage) => total + Math.ceil(message.content.length / 4),
      0,
    );
    const text = step.text ?? '';
    const usage: LLMUsage = {
      promptTokens: step.usage?.promptTokens ?? promptTokens,
      completionTokens: step.usage?.completionTokens ?? Math.ceil(text.length / 4),
      totalTokens: step.usage?.totalTokens ?? promptTokens + Math.ceil(text.length / 4),
    };
    return {
      responseId: newId('llm'),
      requestId: request.requestId,
      provider: this.name,
      model: request.model ?? this.model,
      text,
      ...(step.structured === undefined ? {} : { structured: step.structured }),
      toolCalls: step.toolCalls ?? [],
      usage,
      latencyMs: this.latencyMs,
      finishReason: step.finishReason ?? 'stop',
    };
  }

  /** Fabrique un provider qui répond toujours le même texte. */
  static replying(text: string, model = 'mock-model'): MockLLMProvider {
    return new MockLLMProvider({ steps: [{ text }], model, repeatLast: true });
  }
}
