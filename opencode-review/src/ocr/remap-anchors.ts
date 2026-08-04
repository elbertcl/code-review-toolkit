interface AnchorInput {
  path: string;
  line: number | null;
  is_resolved: boolean;
  is_outdated: boolean;
}

interface ResolvedAnchor {
  path: string;
  line: number;
  is_resolved: boolean;
}

export function resolveAnchors(anchors: AnchorInput[] | null | undefined): ResolvedAnchor[] {
  if (!Array.isArray(anchors)) return [];
  const resolved: ResolvedAnchor[] = [];
  for (const a of anchors) {
    if (a.is_outdated) continue;
    if (a.line == null) continue;
    resolved.push({ path: a.path, line: a.line, is_resolved: a.is_resolved });
  }
  return resolved;
}