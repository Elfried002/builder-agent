/** Couche LLM : abstraction, providers, configuration. */

export { DeepSeekProvider } from './deepseek.js';
export type { MockLLMProviderOptions, MockStep } from './mock.js';
export { MockLLMProvider } from './mock.js';
export type { CreateProviderOptions } from './router.js';
export { createLLMProvider, createLLMProviderFromEnv } from './router.js';
export type {
  LLMConfig,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMToolDeclaration,
  LLMUsage,
} from './types.js';
export {
  DEFAULT_LLM_CONFIG,
  describeLLMConfig,
  LLMProviderName,
  LLMRole,
  loadLLMConfigFromEnv,
} from './types.js';
