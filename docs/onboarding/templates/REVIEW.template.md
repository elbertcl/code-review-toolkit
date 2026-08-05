# Review Manifest

<!-- astro-review-manifest:start -->
```json
{
  "schema_version": 2,
  "policy_path": "docs/review-dimensions.md",
  "verification_commands": [
    "make lint",
    "make test"
  ],
  "required_context": [
    {"path": "AGENTS.md", "role": "instructions"}
  ],
  "optional_context": [],
  "conditional_context": [
    {
      "when_changed": ["src/domain/<domain>/**"],
      "paths": ["docs/invariants/<domain>.md"],
      "role": "invariants"
    }
  ],
  "required_checks": [
    {"name": "CI / lint", "category": "policy"},
    {"name": "CI / test", "category": "test"}
  ],
  "diff_limits": {"changed_files": 100, "changed_lines": 5000},
  "diff_override": {
    "label": "ai-review-size-approved",
    "authorized_associations": ["OWNER", "MEMBER"]
  },
  "docs_only_paths": ["**/*.md"],
  "excluded_paths": ["mocks/**", "vendor/**"]
}
```
<!-- astro-review-manifest:end -->
