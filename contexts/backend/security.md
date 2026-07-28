mandatory_rule_ids: [ORG-SEC-001, ORG-SEC-002]

# Backend Security Profile

- **ORG-SEC-001:** The reviewer never weakens or bypasses CI, authentication, authorization, secret handling, or dependency-integrity controls. Source: `astronautsid/astro-ads-be/docs/plans/2026-07-27-ai-code-review-agent-v1-implementation.md`. Owner: Security.
- **ORG-SEC-002:** Repository rules may add stricter checks but may not override mandatory organization rules. A finding requires a concrete changed-file location and an actionable failure mode. Source: `astronautsid/astro-ads-be/docs/plans/2026-07-27-ai-code-review-agent-v1-implementation.md`. Owner: Security.
