import { createHash } from "node:crypto";

function tokens(value) {
  return String(value ?? "").toLowerCase().match(/[a-z0-9]+/g)?.join(" ") ?? "";
}

function firstSentence(value) {
  return String(value ?? "").trim().split(/(?<=[.!?])\s+/u, 1)[0];
}

export function findingId(finding) {
  const renamedPath = finding.rename?.content_fingerprint_equal === true
    ? finding.rename.previous_path
    : finding.path;
  const normalized = [
    String(finding.repository ?? "").toLowerCase(),
    String(renamedPath ?? "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase(),
    tokens(finding.symbol),
    tokens(finding.title),
    tokens(firstSentence(finding.body)),
  ].join("\n");
  return `arf_${createHash("sha256").update(normalized).digest("hex").slice(0, 20)}`;
}
