/**
 * Provider DeepSeek — provider initial du MVP.
 *
 * Trois exigences de sécurité gouvernent ce fichier :
 *
 * 1. **La clé n'est jamais dans le code, ni dans un type, ni dans un journal.** Elle est lue dans
 *    l'environnement d'exécution au moment de l'appel, transmise dans un en-tête, et jamais
 *    incluse dans un message d'erreur, une preuve ou une trace.
 * 2. **Toute erreur est caviardée avant d'être propagée.** Un corps de réponse ou un message
 *    d'erreur peut contenir un secret ; il passe par le caviardage du cœur avant de remonter.
 * 3. **Aucun repli silencieux.** Sans clé, le provider refuse d'appeler plutôt que de rendre une
 *    réponse vide ou inventée : une absence de configuration doit être visible.
 *
 * Le provider ne fait que **générer**. Il ne détient aucun outil et ne peut rien exécuter.
 */

import { LLMProviderError } from '../errors.js';
import { newId } from '../ids.js';
import { redact } from '../security/secrets.js';
import type { LLMConfig, LLMProvider, LLMRequest, LLMResponse, LLMToolCall } from './types.js';

interface DeepSeekChoice {
  readonly message?: {
    readonly content?: string | null;
    readonly tool_calls?: readonly {
      readonly function?: { readonly name?: string; readonly arguments?: string };
    }[];
  };
  readonly finish_reason?: string;
}

interface DeepSeekBody {
  readonly id?: string;
  readonly model?: string;
  readonly choices?: readonly DeepSeekChoice[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

/** Erreurs pour lesquelles une nouvelle tentative a un sens : réseau, limitation, indisponibilité. */
function isTransient(status: number | null, error: unknown): boolean {
  if (status === null) return true;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

function parseToolCalls(choice: DeepSeekChoice | undefined): LLMToolCall[] {
  const raw = choice?.message?.tool_calls ?? [];
  const calls: LLMToolCall[] = [];
  for (const call of raw) {
    const name = call.function?.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    let parsedArguments: Record<string, unknown> = {};
    const serialized = call.function?.arguments;
    if (typeof serialized === 'string' && serialized.trim() !== '') {
      try {
        const value = JSON.parse(serialized) as unknown;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          parsedArguments = value as Record<string, unknown>;
        }
      } catch {
        // Des arguments illisibles ne sont pas une raison d'inventer un appel : on l'ignore.
        continue;
      }
    }
    calls.push({ name, arguments: parsedArguments });
  }
  return calls;
}

export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  readonly model: string;
  private readonly config: LLMConfig;
  private readonly fetchImpl: typeof fetch;
  /**
   * Lecteur de clé, et non la clé.
   *
   * Le provider ne conserve **jamais** l'environnement ni la clé dans un champ : il conserve une
   * fonction qui la lit. C'est ce qui rend une fuite accidentelle impossible — `JSON.stringify`
   * sur un provider journalisé n'expose alors rien, puisqu'une fonction ne se sérialise pas.
   */
  private readonly readApiKey: () => string | undefined;

  constructor(
    config: LLMConfig,
    options: {
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly fetchImpl?: typeof fetch;
      /** Lecteur de clé explicite, prioritaire sur `env`. */
      readonly apiKey?: () => string | undefined;
    } = {},
  ) {
    this.config = config;
    this.model = config.model;
    const env = options.env ?? process.env;
    this.readApiKey = options.apiKey ?? (() => env[config.apiKeyEnvVar]);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Indique si la clé est disponible, **sans jamais la lire ni la rendre**.
   * Sert à refuser tôt, avec un message actionnable, plutôt que d'échouer au milieu d'un appel.
   */
  hasApiKey(): boolean {
    const value = this.readApiKey();
    return typeof value === 'string' && value.trim().length > 0;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.readApiKey();
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new LLMProviderError(
        `clé d'API absente : la variable d'environnement ${this.config.apiKeyEnvVar} n'est pas définie`,
        { context: { provider: this.name, expectedEnvVar: this.config.apiKeyEnvVar } },
      );
    }

    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
    const model = request.model ?? this.config.model;
    const messages = [
      ...(request.system === undefined
        ? []
        : [{ role: 'system' as const, content: request.system }]),
      ...(request.context === undefined
        ? []
        : [{ role: 'system' as const, content: request.context }]),
      ...request.messages.map((message) => ({ role: message.role, content: message.content })),
    ];
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      stream: false,
    };
    if (request.structuredSchema !== undefined) {
      payload.response_format = { type: 'json_object' };
    }
    if (request.tools !== undefined && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parametersSchema ?? { type: 'object', properties: {} },
        },
      }));
    }

    const startedAt = Date.now();
    let lastError: string = '';

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let status: number | null = null;
      try {
        const response = await this.fetchImpl(
          `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        status = response.status;
        const raw = await response.text();
        if (!response.ok) {
          lastError = `réponse ${status} : ${redact(raw).slice(0, 300)}`;
          if (attempt < this.config.maxRetries && isTransient(status, null)) continue;
          throw new LLMProviderError(`appel au fournisseur refusé — ${lastError}`, {
            context: { provider: this.name, model, status },
          });
        }
        const body = JSON.parse(raw) as DeepSeekBody;
        const choice = body.choices?.[0];
        const text = choice?.message?.content ?? '';
        const structured =
          request.structuredSchema !== undefined && text.trim().length > 0
            ? this.parseStructured(text, request)
            : undefined;
        return {
          responseId: body.id ?? newId('llm'),
          requestId: request.requestId,
          provider: this.name,
          model: body.model ?? model,
          text,
          ...(structured === undefined ? {} : { structured }),
          toolCalls: parseToolCalls(choice),
          usage: {
            promptTokens: body.usage?.prompt_tokens ?? 0,
            completionTokens: body.usage?.completion_tokens ?? 0,
            totalTokens: body.usage?.total_tokens ?? 0,
          },
          latencyMs: Date.now() - startedAt,
          finishReason: choice?.finish_reason ?? 'unknown',
        };
      } catch (error) {
        if (error instanceof LLMProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        lastError = redact(message).slice(0, 300);
        if (attempt < this.config.maxRetries && isTransient(status, error)) continue;
        throw new LLMProviderError(`appel au fournisseur impossible — ${lastError}`, {
          context: { provider: this.name, model, attempts: attempt + 1 },
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    throw new LLMProviderError(`appel au fournisseur épuisé — ${lastError}`, {
      context: { provider: this.name, model, attempts: this.config.maxRetries + 1 },
    });
  }

  /** Analyse une sortie structurée ; un JSON invalide est une erreur explicite, pas un objet vide. */
  private parseStructured(text: string, request: LLMRequest): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new LLMProviderError('sortie structurée illisible : le modèle n’a pas rendu du JSON', {
        context: { provider: this.name, requestId: request.requestId },
      });
    }
  }
}
