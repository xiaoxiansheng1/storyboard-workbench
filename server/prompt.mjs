export function buildPrompt(data, config) {
  const primary = config.promptLang === 'zh' ? data.promptZh : data.promptEn;
  const fallback = config.promptLang === 'zh' ? data.promptEn : data.promptZh;
  let prompt = String(primary || fallback || '').trim();
  if (config.appendNegative) {
    const negative = config.promptLang === 'zh' ? data.negativeZh : data.negativeEn;
    if (negative) prompt += `\n\nAvoid: ${negative}`;
  }
  return prompt;
}
