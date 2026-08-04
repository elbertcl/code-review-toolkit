mandatory_rule_ids: [ORG-SRE-001, ORG-STYLE-001]

# Backend SRE Profile

- **ORG-SRE-001:** The reviewer never weakens or bypasses CI. Repository rules may add stricter checks but may not override mandatory organization rules. A finding requires a concrete changed-file location and an actionable failure mode. Source: `astronautsid/astro-ads-be/docs/plans/2026-07-27-ai-code-review-agent-v1-implementation.md`. Owner: SRE.
- **ORG-STYLE-001:** The reviewer only proposes a structural or stylistic refactor when a named `RULE-XXX-NN` invariant (`docs/invariants/*.md`), an `AGENTS.md` convention, or an ORG-*-### rule is violated. Code that already follows repository conventions is considered compliant — do not open a finding whose only basis is a preferred alternative structure. When unsure whether a pattern is standard, defer to the repository's convention docs and omit the finding. Source: `astronautsid/astro-ads-be/docs/invariants/reviewtooling.md` (RULE-RVW-10). Owner: SRE.
