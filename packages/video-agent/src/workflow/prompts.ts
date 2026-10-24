export type PromptVariables = Record<string, string | number | undefined | null>;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * 渲染 Mustache 风格占位符。
 *
 * - 缺失或空值填「无」，与 `.agents/prompts/*.user.md` 的约定一致；
 * - 渲染后仍有 `{{...}}` 说明模板写错，直接抛错，避免把占位符发给模型。
 */
export function renderPrompt(template: string, variables: PromptVariables): string {
  const rendered = template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = variables[key];

    if (value === undefined || value === null || String(value).trim() === '') {
      return '无';
    }

    return String(value);
  });

  const unresolved = rendered.match(/\{\{[^}]+\}\}/g);

  if (unresolved) {
    throw new Error(`unresolved prompt placeholders: ${unresolved.join(', ')}`);
  }

  return rendered;
}
