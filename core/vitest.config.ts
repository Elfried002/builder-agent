import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // Les tests ne doivent jamais dépendre d'un accès réseau ni d'une clé d'API.
    clearMocks: true,
  },
});
