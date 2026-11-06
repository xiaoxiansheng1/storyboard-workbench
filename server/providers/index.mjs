import { createMockProvider } from './mock.mjs';
import { createOpenAIProvider } from './openai.mjs';

export function createProvider(config) {
  if (config.provider === 'mock') return createMockProvider();
  if (config.provider === 'openai') return createOpenAIProvider(config);
  throw new Error(`未知的 IMAGE_PROVIDER: ${config.provider}（可选 mock / openai）`);
}
