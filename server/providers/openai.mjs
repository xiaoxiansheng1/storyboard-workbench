import { decodeBase64, downloadImage, mimeFor } from './download.mjs';
import { timeoutSignal } from './signal.mjs';

export function createOpenAIProvider(config) {
  const { baseUrl, apiKey, model, size, quality, responseFormat, extraHeaders, extraBody } = config.openai;
  const timeoutMs = config.timeoutMs;

  return {
    name: 'openai',
    model,
    async generate({ prompt, seed, signal }) {
      if (!apiKey && !Object.keys(extraHeaders).length) {
        throw new Error('未配置 OPENAI_API_KEY；本地无鉴权端点可设置 IMAGE_EXTRA_HEADERS 后再试');
      }

      const body = { model, prompt, n: 1, size };
      if (quality) body.quality = quality;
      if (responseFormat === 'b64_json' || responseFormat === 'url') body.response_format = responseFormat;
      if (config.requestSeed && seed !== undefined) body.seed = seed;
      Object.assign(body, extraBody);

      const headers = { 'Content-Type': 'application/json', ...extraHeaders };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutSignal(timeoutMs, signal),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`端点返回的不是 JSON：${text.slice(0, 200)}`);
      }

      const item = json?.data?.[0];
      if (!item) throw new Error(`响应中没有图片数据：${text.slice(0, 300)}`);
      if (item.b64_json) {
        const data = decodeBase64(item.b64_json);
        return { data, mime: mimeFor(data) };
      }
      if (item.url) return downloadImage(new URL(item.url, `${baseUrl}/`).toString(), timeoutMs, signal);

      throw new Error(`响应格式无法识别（既无 b64_json 也无 url）：${text.slice(0, 300)}`);
    },
  };
}
