import { createAicloneProvider } from './aiclone.mjs';
import { createMockProvider } from './mock.mjs';
import { createOpenAIProvider } from './openai.mjs';

export function createProvider(config, name, imageModel) {
  if (name === 'mock') return createMockProvider();
  if (name === 'aiclone') return createAicloneProvider(config, imageModel);
  if (name === 'openai') return createOpenAIProvider(config);
  throw new Error(`未知的 IMAGE_PROVIDER: ${name}（可选 auto / mock / aiclone / openai）`);
}
