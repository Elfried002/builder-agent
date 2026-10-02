/**
 * Tests de la couche LLM : abstraction, provider simulé, provider DeepSeek (réseau injecté),
 * configuration et **protection des secrets**.
 *
 * Aucun test ne contacte un fournisseur réel et aucun ne contient de clé : la clé factice est
 * construite par concaténation, comme pour les tests de détection de secrets.
 */

import { describe, expect, it, vi } from 'vitest';

import { LLMProviderError } from '../src/errors.js';
import type { LLMConfig, LLMRequest } from '../src/llm/index.js';
import {
  createLLMProvider,
  createLLMProviderFromEnv,
  DeepSeekProvider,
  describeLLMConfig,
  LLMProviderName,
  LLMRole,
  loadLLMConfigFromEnv,
  MockLLMProvider,
} from '../src/llm/index.js';

/** Clé factice, jamais réelle et jamais écrite ailleurs que dans ce test. */
function fakeApiKey(): string {
  return `${'sk'}-${'Zq3Wm8Rt5Yp2Kd7Vb4Nx6Lc9Md1Pe5Qw'}`;
}

function request(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    requestId: 'req_test_0001',
    messages: [{ role: LLMRole.User, content: 'Explique le plan.' }],
    ...overrides,
  };
}

function deepseekConfig(): LLMConfig {
  return { ...loadLLMConfigFromEnv({}), provider: LLMProviderName.DeepSeek };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SUCCESS_BODY = {
  id: 'chatcmpl-test',
  model: 'deepseek-chat',
  choices: [
    {
      message: { content: 'Voici le plan.' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
};

describe('configuration LLM', () => {
  it('applique les valeurs par défaut du MVP (DeepSeek)', () => {
    const config = loadLLMConfigFromEnv({});
    expect(config.provider).toBe('deepseek');
    expect(config.model).toBe('deepseek-chat');
    expect(config.apiKeyEnvVar).toBe('CODIDEV_DEEPSEEK_API_KEY');
  });

  it('accepte une configuration par environnement', () => {
    const config = loadLLMConfigFromEnv({
      CODIDEV_LLM_PROVIDER: 'mock',
      CODIDEV_LLM_MODEL: 'modele-test',
      CODIDEV_LLM_TIMEOUT_MS: '1500',
      CODIDEV_LLM_MAX_RETRIES: '0',
    });
    expect(config.provider).toBe('mock');
    expect(config.model).toBe('modele-test');
    expect(config.timeoutMs).toBe(1500);
    expect(config.maxRetries).toBe(0);
  });

  it('refuse un provider inconnu : aucun repli silencieux', () => {
    expect(() =>
      loadLLMConfigFromEnv({ CODIDEV_LLM_PROVIDER: 'fournisseur-inconnu' }),
    ).toThrowError(/provider LLM inconnu/);
  });

  it('la configuration ne contient jamais de clé', () => {
    const key = fakeApiKey();
    const config = loadLLMConfigFromEnv({ CODIDEV_DEEPSEEK_API_KEY: key });
    const described = JSON.stringify(describeLLMConfig(config));
    expect(described).not.toContain(key);
    expect(config.apiKeyEnvVar).toBe('CODIDEV_DEEPSEEK_API_KEY');
  });

  it('construit le provider simulé depuis l’environnement', () => {
    const { provider } = createLLMProviderFromEnv({
      CODIDEV_LLM_PROVIDER: 'mock',
      CODIDEV_LLM_MODEL: 'mock-model',
    });
    expect(provider.name).toBe('mock');
  });

  it('refuse un provider inconnu à la construction', () => {
    expect(() =>
      createLLMProvider({ ...deepseekConfig(), provider: 'autre' as never }),
    ).toThrowError(/provider LLM inconnu|non pris en charge/);
  });
});

describe('provider simulé', () => {
  it('rend la réponse scriptée et enregistre la demande', async () => {
    const provider = new MockLLMProvider({ steps: [{ text: 'réponse scriptée' }] });
    const response = await provider.generate(request());
    expect(response.text).toBe('réponse scriptée');
    expect(response.provider).toBe('mock');
    expect(response.requestId).toBe('req_test_0001');
    expect(provider.calls).toHaveLength(1);
    expect(provider.lastCall?.messages[0]?.content).toBe('Explique le plan.');
  });

  it('échoue plutôt que d’inventer quand le scénario est épuisé', async () => {
    const provider = new MockLLMProvider({ steps: [] });
    await expect(provider.generate(request())).rejects.toThrowError(LLMProviderError);
  });

  it('propage une erreur scriptée', async () => {
    const provider = new MockLLMProvider({ steps: [{ error: 'panne simulée' }] });
    await expect(provider.generate(request())).rejects.toThrowError(/panne simulée/);
  });

  it('expose les appels d’outils proposés sans les exécuter', async () => {
    const provider = new MockLLMProvider({
      steps: [{ toolCalls: [{ name: 'git.push', arguments: { branch: 'main' } }] }],
    });
    const response = await provider.generate(request());
    expect(response.toolCalls).toHaveLength(1);
    // Un provider ne fait que proposer : rien n'a été exécuté, aucun outil n'est disponible ici.
    expect(response.toolCalls[0]?.name).toBe('git.push');
  });

  it('fabrique un provider qui répond toujours la même chose', async () => {
    const provider = MockLLMProvider.replying('bonjour');
    expect((await provider.generate(request())).text).toBe('bonjour');
    expect((await provider.generate(request())).text).toBe('bonjour');
  });
});

describe('provider DeepSeek — sécurité des clés', () => {
  it('refuse d’appeler sans clé, et nomme la variable attendue', async () => {
    const provider = new DeepSeekProvider(deepseekConfig(), { env: {} });
    expect(provider.hasApiKey()).toBe(false);
    await expect(provider.generate(request())).rejects.toThrowError(/CODIDEV_DEEPSEEK_API_KEY/);
  });

  it('détecte la présence de la clé sans jamais la rendre', () => {
    const key = fakeApiKey();
    const provider = new DeepSeekProvider(deepseekConfig(), {
      env: { CODIDEV_DEEPSEEK_API_KEY: key },
    });
    expect(provider.hasApiKey()).toBe(true);
    expect(JSON.stringify(provider)).not.toContain(key);
  });

  it('n’inclut jamais la clé dans un message d’erreur, même si le corps en contient', async () => {
    const key = fakeApiKey();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `clé refusée : ${key}` } }, 401),
    ) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(
      { ...deepseekConfig(), maxRetries: 0 },
      { env: { CODIDEV_DEEPSEEK_API_KEY: key }, fetchImpl },
    );
    await expect(provider.generate(request())).rejects.toThrowError(/appel au fournisseur refusé/);
    try {
      await provider.generate(request());
    } catch (error) {
      expect(String(error)).not.toContain(key);
      expect((error as LLMProviderError).message).toContain('REDACTED');
    }
  });

  it('n’expose jamais la clé dans les journaux du cœur : elle n’est pas un type', () => {
    const key = fakeApiKey();
    const config = loadLLMConfigFromEnv({ CODIDEV_DEEPSEEK_API_KEY: key });
    expect(Object.values(config).join('|')).not.toContain(key);
  });
});

describe('provider DeepSeek — comportement', () => {
  it('transmet système, contexte et messages dans l’ordre attendu', async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return jsonResponse(SUCCESS_BODY);
    }) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(deepseekConfig(), {
      env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() },
      fetchImpl,
    });
    await provider.generate(
      request({ system: 'Tu es le cœur de CodiDev.', context: '### SYSTEM [TRUSTED] règle' }),
    );
    const body = calls[0] as { messages: { role: string; content: string }[] };
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content).toContain('cœur de CodiDev');
    expect(body.messages[1]?.content).toContain('SYSTEM');
    expect(body.messages[2]?.role).toBe('user');
  });

  it('analyse la réponse, l’usage et le modèle', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SUCCESS_BODY)) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(deepseekConfig(), {
      env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() },
      fetchImpl,
    });
    const response = await provider.generate(request());
    expect(response.text).toBe('Voici le plan.');
    expect(response.model).toBe('deepseek-chat');
    expect(response.usage.totalTokens).toBe(17);
    expect(response.finishReason).toBe('stop');
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('analyse les appels d’outils proposés', async () => {
    const body = {
      ...SUCCESS_BODY,
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ function: { name: 'file.write', arguments: '{"path":"a.ts"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(deepseekConfig(), {
      env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() },
      fetchImpl,
    });
    const response = await provider.generate(request());
    expect(response.toolCalls[0]?.name).toBe('file.write');
    expect(response.toolCalls[0]?.arguments).toEqual({ path: 'a.ts' });
  });

  it('réessaie sur une erreur transitoire puis réussit', async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return jsonResponse({ error: 'indisponible' }, 503);
      return jsonResponse(SUCCESS_BODY);
    }) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(
      { ...deepseekConfig(), maxRetries: 1 },
      { env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() }, fetchImpl },
    );
    const response = await provider.generate(request());
    expect(response.text).toBe('Voici le plan.');
    expect(attempt).toBe(2);
  });

  it('ne réessaie pas sur une erreur de requête', async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      return jsonResponse({ error: 'requête invalide' }, 400);
    }) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(
      { ...deepseekConfig(), maxRetries: 3 },
      { env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() }, fetchImpl },
    );
    await expect(provider.generate(request())).rejects.toThrowError(LLMProviderError);
    expect(attempt).toBe(1);
  });

  it('gère un échec réseau sans le masquer', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('réseau indisponible');
    }) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(
      { ...deepseekConfig(), maxRetries: 0 },
      { env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() }, fetchImpl },
    );
    await expect(provider.generate(request())).rejects.toThrowError(/réseau indisponible/);
  });

  it('analyse une sortie structurée et refuse un JSON illisible', async () => {
    const valide = vi.fn(async () =>
      jsonResponse({
        ...SUCCESS_BODY,
        choices: [{ message: { content: '{"etapes":3}' }, finish_reason: 'stop' }],
      }),
    ) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(deepseekConfig(), {
      env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() },
      fetchImpl: valide,
    });
    const response = await provider.generate(
      request({ structuredSchema: { type: 'object', properties: { etapes: { type: 'number' } } } }),
    );
    expect(response.structured).toEqual({ etapes: 3 });

    const invalide = vi.fn(async () =>
      jsonResponse({
        ...SUCCESS_BODY,
        choices: [{ message: { content: 'pas du json' }, finish_reason: 'stop' }],
      }),
    ) as unknown as typeof fetch;
    const autre = new DeepSeekProvider(deepseekConfig(), {
      env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() },
      fetchImpl: invalide,
    });
    await expect(
      autre.generate(request({ structuredSchema: { type: 'object' } })),
    ).rejects.toThrowError(/sortie structurée illisible/);
  });

  it('demande une sortie JSON au fournisseur quand un schéma est fourni', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ ...SUCCESS_BODY, choices: [{ message: { content: '{}' } }] });
    }) as unknown as typeof fetch;
    const provider = new DeepSeekProvider(deepseekConfig(), {
      env: { CODIDEV_DEEPSEEK_API_KEY: fakeApiKey() },
      fetchImpl,
    });
    await provider.generate(request({ structuredSchema: { type: 'object' } }));
    expect(bodies[0]?.response_format).toEqual({ type: 'json_object' });
  });
});
