<!-- astro-review-manifest:start -->
```json
{
  "schema_version": 2,
  "policy_path": "docs/review-dimensions.md",
  "verification_commands": [
    "make build-all",
    "make test",
    "make lint"
  ],
  "required_context": [
    {"path": "AGENTS.md", "role": "instructions"},
    {"path": "docs/conventions/golang.md", "role": "conventions"},
    {"path": "docs/architecture/README.md", "role": "architecture"}
  ],
  "optional_context": [
    {"path": "docs/conventions/database.md", "role": "conventions"}
  ],
  "conditional_context": [
    {
      "when_changed": ["internal/domain/creditmanager/**"],
      "paths": ["docs/invariants/creditmanager.md", "docs/testspecs/creditmanager.md"],
      "role": "invariants"
    }
  ],
  "review_directives": [
    {
      "when_changed": ["internal/**/handler/**"],
      "directive": "Handlers must delegate business logic to services. Do not embed domain logic directly in HTTP handlers."
    }
  ],
  "required_checks": [
    {"name": "CI / lint", "category": "test"},
    {"name": "CI / test", "category": "test"},
    {"name": "CI / build", "category": "test"}
  ],
  "diff_limits": {
    "changed_files": 100,
    "changed_lines": 5000
  },
  "docs_only_paths": ["**/*.md"],
  "excluded_paths": ["mocks/**", "vendor/**"]
}
```
<!-- astro-review-manifest:end -->