/**
 * Abstraction LLM du Core CodiDev.
 *
 * **Le LLM n'est pas le Core, et il n'en détient aucune autorité.** Cette couche est un moteur de
 * raisonnement et de génération : elle reçoit du texte et du contexte, elle rend du texte ou une
 * sortie structurée. Elle n'accède à aucun outil, à aucun fichier, à aucune permission.
 *
 * Un provider peut **déclarer** des outils (le format attendu par un modèle qui sait produire un
 * appel d'outil), et peut **proposer** un appel — mais l'exécution est hors de sa portée : elle
 * appartient au cœur, qui la soumet à la politique, aux permissions et au Human Gate.
 *
 * La clé d'API n'apparaît jamais dans un type : la configuration ne porte que le **nom** de la
 * variable d'environnement qui la contient, et le provider la résout au moment de l'appel.
 */

/** Rôles d'un message transmis au modèle. */
export const LLMRole = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
  Tool: 'tool',
} as const;
export type LLMRole = (typeof LLMRole)[keyof typeof LLMRole];

export interface LLMMessage {
  readonly role: LLMRole;
  readonly content: string;
}

/**
 * Outil **déclaré** au modèle, à seule fin qu'il puisse en proposer l'appel.
 * Aucune implémentation n'est fournie ici : un provider qui exécuterait un outil par lui-même
 * violerait directement la frontière de sécurité du cœur.
 */
export interface LLMToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema?: Record<string, unknown>;
}

/** Demande adressée à un provider. */
export interface LLMRequest {
  /** Identifiant de corrélation, repris dans la réponse et dans les preuves. */
  readonly requestId: string;
  readonly messages: readonly LLMMessage[];
  /** Consignes système, distinctes des messages : elles ne sont pas une conversation. */
  readonly system?: string;
  /** Contexte rendu par le Context Engine — jamais reconstitué par le provider. */
  readonly context?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  /** Sortie structurée attendue (JSON Schema) : le provider ne doit pas inventer librement. */
  readonly structuredSchema?: Record<string, unknown>;
  readonly tools?: readonly LLMToolDeclaration[];
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Consommation déclarée par le provider, tracée pour l'audit et les quotas. */
export interface LLMUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** Appel d'outil **proposé** par le modèle. Une proposition, jamais une exécution. */
export interface LLMToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** Réponse d'un provider. */
export interface LLMResponse {
  readonly responseId: string;
  readonly requestId: string;
  /** Nom du provider ayant répondu : la traçabilité n'est pas facultative. */
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  /** Sortie structurée, présente lorsque `structuredSchema` a été fourni. */
  readonly structured?: unknown;
  readonly toolCalls: readonly LLMToolCall[];
  readonly usage: LLMUsage;
  readonly latencyMs: number;
  readonly finishReason: string;
}

/** Interface unique des providers. DeepSeek est le provider initial, pas une dépendance. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}

/** Nom du provider retenu par la configuration. */
export const LLMProviderName = {
  DeepSeek: 'deepseek',
  Mock: 'mock',
} as const;
export type LLMProviderName = (typeof LLMProviderName)[keyof typeof LLMProviderName];

/**
 * Configuration d'un provider.
 *
 * Elle ne contient **aucune clé** : seulement le nom de la variable d'environnement qui la porte.
 * Une clé écrite dans un fichier versionné, un journal, une preuve ou un message est un incident
 * de sécurité, pas une commodité.
 */
export interface LLMConfig {
  readonly provider: LLMProviderName;
  readonly model: string;
  readonly apiKeyEnvVar: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxTokens: number;
  readonly temperature: number;
}

/** Valeurs par défaut du MVP : DeepSeek, modèle configurable au moment de l'intégration. */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: LLMProviderName.DeepSeek,
  model: 'deepseek-chat',
  apiKeyEnvVar: 'CODIDEV_DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com/v1',
  timeoutMs: 60_000,
  maxRetries: 2,
  maxTokens: 4_096,
  temperature: 0.2,
};

function envInt(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envNumber(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Lit la configuration depuis l'environnement d'exécution.
 *
 * La clé elle-même n'est **jamais** lue ici : seule sa variable est nommée. Le cœur ne manipule
 * donc jamais un secret, ce qui rend une fuite par journalisation structurellement impossible
 * dans cette couche.
 */
export function loadLLMConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LLMConfig {
  const provider = env.CODIDEV_LLM_PROVIDER?.trim() || DEFAULT_LLM_CONFIG.provider;
  if (provider !== LLMProviderName.DeepSeek && provider !== LLMProviderName.Mock) {
    throw new Error(
      `provider LLM inconnu : ${provider} (attendu : deepseek ou mock) — aucun repli silencieux`,
    );
  }
  return {
    provider,
    model: env.CODIDEV_LLM_MODEL?.trim() || DEFAULT_LLM_CONFIG.model,
    apiKeyEnvVar: env.CODIDEV_LLM_API_KEY_ENV?.trim() || DEFAULT_LLM_CONFIG.apiKeyEnvVar,
    baseUrl: env.CODIDEV_LLM_BASE_URL?.trim() || DEFAULT_LLM_CONFIG.baseUrl,
    timeoutMs: envInt(env, 'CODIDEV_LLM_TIMEOUT_MS', DEFAULT_LLM_CONFIG.timeoutMs),
    maxRetries: envInt(env, 'CODIDEV_LLM_MAX_RETRIES', DEFAULT_LLM_CONFIG.maxRetries),
    maxTokens: envInt(env, 'CODIDEV_LLM_MAX_TOKENS', DEFAULT_LLM_CONFIG.maxTokens),
    temperature: envNumber(env, 'CODIDEV_LLM_TEMPERATURE', DEFAULT_LLM_CONFIG.temperature),
  };
}

/** Description publique de la configuration, sûre à journaliser : jamais de clé. */
export function describeLLMConfig(config: LLMConfig): Record<string, unknown> {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeyEnvVar: config.apiKeyEnvVar,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  };
}
