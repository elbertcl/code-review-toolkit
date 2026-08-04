interface Thread {
  path: string;
  line: number;
  is_resolved: boolean;
  is_outdated: boolean;
}

interface OcrRule {
  path: string;
  rule: string;
}

export function buildResolvedDirectives(threads: Thread[] | null | undefined): OcrRule[] {
  if (!Array.isArray(threads)) return [];
  const rules: OcrRule[] = [];
  for (const t of threads) {
    if (!t.is_resolved || t.is_outdated) continue;
    rules.push({
      path: t.path,
      rule: `A prior review finding near line ${t.line} was resolved/discussed on this PR. Do NOT re-flag unless the diff introduces a new, distinct issue at this anchor.`,
    });
  }
  return rules;
}