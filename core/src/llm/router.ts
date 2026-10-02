/**
 * Sélection du provider LLM.
 *
 * Le cœur ne dépend d'aucun fournisseur nommé : il dépend de l'interface `LLMProvider`. Changer de
 * fournisseur est un changement de configuration, pas un changement d'architecture.
 */

import { LLMProviderError } from '../errors.js';
import { DeepSeekProvider } from './deepseek.js';
import { MockLLMProvider, type MockStep } from './mock.js';
import {
  type LLMConfig,
  type LLMProvider,
  LLMProviderName,
  loadLLMConfigFromEnv,
} from './types.js';

export interface CreateProviderOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injecté dans les tests : aucun appel réseau réel n'est effectué. */
  readonly fetchImpl?: typeof fetch;
  /** Scénario du provider simulé, lorsque celui-ci est retenu. */
  readonly mockSteps?: readonly MockStep[];
}

/**
 * Construit le provider décrit par la configuration.
 *
 * Aucun repli silencieux : un provider inconnu lève, et le provider simulé sans scénario échoue au
 * premier appel plutôt que de rendre une réponse inventée.
 */
export function createLLMProvider(
  config: LLMConfig,
  options: CreateProviderOptions = {},
): LLMProvider {
  if (config.provider === LLMProviderName.Mock) {
    return new MockLLMProvider({
      steps: options.mockSteps ?? [],
      model: config.model,
    });
  }
  if (config.provider === LLMProviderName.DeepSeek) {
    return new DeepSeekProvider(config, {
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }
  // Aucun repli par défaut : un provider inconnu doit être visible à la construction, pas
  // découvert au milieu d'un cycle parce qu'un autre fournisseur a répondu à sa place.
  throw new LLMProviderError(
    `provider LLM non pris en charge : ${String(config.provider)} — aucun repli silencieux`,
    { context: { supported: Object.values(LLMProviderName) } },
  );
}

/** Construit le provider à partir de l'environnement d'exécution. */
export function createLLMProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: Omit<CreateProviderOptions, 'env'> = {},
): { provider: LLMProvider; config: LLMConfig } {
  const config = loadLLMConfigFromEnv(env);
  return { provider: createLLMProvider(config, { ...options, env }), config };
}
