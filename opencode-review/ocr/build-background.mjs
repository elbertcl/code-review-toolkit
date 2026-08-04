export function buildBackground(threads) {
  if (!Array.isArray(threads) || threads.length === 0) {
    return "No prior review threads on this PR.";
  }

  const capped = threads.slice(0, 50);

  const directive =
    "The following reviewer threads are already open on this PR. Do NOT re-flag " +
    "a finding whose (path, line) is listed here unless the diff introduces a new, " +
    "distinct issue at that anchor. Prefer replying to the existing thread over " +
    "opening a duplicate.";

  const lines = capped.map((thread) => {
    const excerpt = String(thread.latest_body_excerpt ?? "").slice(0, 200).replace(/\s+/g, " ").trim();
    const author = String(thread.latest_author ?? "unknown");
    return `- ${thread.path}:${thread.line} (@${author}): ${excerpt}`;
  });

  return `${directive}\n\n${lines.join("\n")}`;
}
