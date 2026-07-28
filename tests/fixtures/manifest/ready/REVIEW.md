# Review Context

<!-- astro-review-manifest:start -->
```json
{
  "schema_version": 1,
  "profile": "backend",
  "organization_profiles": ["backend/security", "backend/sre"],
  "policy_path": "docs/review-dimensions.md",
  "verification_commands": ["make lint"],
  "required_context": [{"path":"AGENTS.md","role":"instructions"}],
  "optional_context": [{"path":"docs/conventions/go.md","role":"conventions"}],
  "conditional_context": [{"when_changed":["internal/domain/admanager/**"],"paths":["docs/invariants/admanager.md"],"role":"invariants"}],
  "required_checks": [{"name":"Build and Test","category":"test"}],
  "diff_limits": {"changed_files":40,"changed_lines":1200},
  "diff_override": {"label":"ai-review-size-approved","authorized_associations":["OWNER","MEMBER"]},
  "docs_only_paths": ["**/*.md","docs/**"],
  "excluded_paths": ["mocks/**","**/*.pb.go"]
}
```
<!-- astro-review-manifest:end -->
