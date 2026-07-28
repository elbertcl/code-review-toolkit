const STATUSES = new Set(["available", "unavailable", "timed_out", "disabled"]);

export function addSerenaStatus(artifact, status) {
  if (Object.hasOwn(artifact, "serena")) throw new Error("artifact already contains Serena status");
  if (!status || status.schema_version !== 1 || !STATUSES.has(status.status)) throw new Error("Serena status is invalid");
  if (!/^[0-9a-f]{40}$/i.test(status.revision ?? "")) throw new Error("Serena revision is invalid");
  if (typeof status.reason !== "string" || !status.reason) throw new Error("Serena reason is invalid");
  if (status.warning !== undefined && (typeof status.warning !== "string" || !status.warning || status.warning.length > 500)) throw new Error("Serena warning is invalid");
  return { ...artifact, serena: { ...status } };
}
