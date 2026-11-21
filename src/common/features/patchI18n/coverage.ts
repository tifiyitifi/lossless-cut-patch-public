/* Fork-owned i18n coverage helpers. */

export function extractTKeys(source: string): string[] {
  const found: string[] = [];
  let index = 0;
  while (true) {
    const at = source.indexOf('t(', index);
    if (at === -1) {
      break;
    }
    index = at + 2;
    if (at > 0) {
      const before = source[at - 1];
      if (before != null && /[A-Za-z0-9_]/.test(before)) {
        continue;
      }
    }
    // Find the matching ')' for this t() call, skipping over string literals.
    let depth = 1;
    let end = -1;
    let cursor = index;
    while (cursor < source.length) {
      const ch = source[cursor];
      if (ch === '\'' || ch === '"' || ch === '`') {
        const q = ch;
        cursor += 1;
        while (cursor < source.length) {
          if (source[cursor] === q && source[cursor - 1] !== '\\') {
            break;
          }
          cursor += 1;
        }
        cursor += 1;
        continue;
      }
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
      cursor += 1;
    }
    if (end === -1) {
      break;
    }
    const inner = source.slice(index, end);
    index = end + 1;
    for (const m of inner.matchAll(/'([^'\n]*(?:\\'[^'\n]*)*)'|"([^"\n]*(?:\\"[^"\n]*)*)"|`([^`\n]*(?:\\`[^`\n]*)*)`/g)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? '';
      const key = raw.split(String.raw`\'`).join('\'');
      if (key.length > 0 && !key.includes('\n')) {
        found.push(key);
      }
    }
  }
  return [...new Set(found)];
}

export function placeholdersOf(text: string): string[] {
  const variables = [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1] ?? '');
  // `<Trans>` keys place their components by index (`<0>...</0>`, `<1></1>`), which the `{{}}`
  // scanner cannot see. The indices must match between the two languages, so they join the set.
  const components = [...new Set([...text.matchAll(/<(\d+)>/g)].map((m) => `<${m[1]}>`))];
  return [...variables, ...components].sort();
}

export function findMissingTranslations(
  forkKeys: readonly string[],
  en: Readonly<Record<string, string>>,
  zh: Readonly<Record<string, string>>,
): string[] {
  const missing: string[] = [];
  for (const key of forkKeys) {
    if (key in en) {
      if (!(key in zh)) {
        missing.push(key);
      }
      continue;
    }
    const one = `${key}_one`;
    const other = `${key}_other`;
    if ((one in en || other in en) && (!(one in zh) || !(other in zh))) {
      missing.push(key);
    }
  }
  return missing;
}

export function findPlaceholderMismatches(
  forkKeys: readonly string[],
  en: Readonly<Record<string, string>>,
  zh: Readonly<Record<string, string>>,
): string[] {
  const mismatched: string[] = [];
  for (const key of forkKeys) {
    const enValue = en[key];
    const zhValue = zh[key];
    if (enValue == null || zhValue == null) {
      continue;
    }
    const enVars = placeholdersOf(enValue).join(',');
    const zhVars = placeholdersOf(zhValue).join(',');
    if (enVars !== zhVars) {
      mismatched.push(key);
    }
  }
  return mismatched;
}
