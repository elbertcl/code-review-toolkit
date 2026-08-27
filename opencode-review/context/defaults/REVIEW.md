<!-- astro-review-manifest:start -->
```json
{
  "schema_version": 2,
  "policy_path": "docs/review-dimensions.md",
  "verification_commands": ["make lint"],
  "required_context": [
    {"path": "AGENTS.md", "role": "instructions"}
  ],
  "optional_context": [],
  "conditional_context": [],
  "required_checks": [
    {"name": "PR Checks", "category": "test"}
  ],
  "diff_limits": {
    "changed_files": 100,
    "changed_lines": 5000
  },
  "diff_override": {
    "label": "ai-review-size-approved",
    "authorized_associations": ["OWNER", "MEMBER"]
  },
  "docs_only_paths": ["**/*.md", "docs/**"],
  "excluded_paths": ["mocks/**", "vendor/**"]
}
```
<!-- astro-review-manifest:end -->

<!--
  Optional per-repo engine preferences (schema_version 3). Uncomment and set
  schema_version to 3 above to use. Precedence: workflow input > engine block >
  org variable OCR_LLM_MODEL > toolkit default. Credentials never go here.

  "engine": {
    "ocr_model": "deepseek/deepseek-v4-pro",
    "ocr_cost_rates": {"deepseek/deepseek-v4-pro": {"input_per_million": 0.14, "output_per_million": 0.28}},
    "serena": true,
    "org_profiles_add": ["backend/security"]
  }
-->

# Review Dimensions

> This is the org-default manifest. Add a repo-owned `REVIEW.md` to override.

## Section 1: Business Correctness

- **Invariant rule enforcement:** Every RULE-XXX-NN invariant must be verified against the changed code.

## Section 2: Performance

- **N+1 DB calls:** Do not call the database per iteration.

## Section 3: Maintainability

- **Code style:** Follow the repository's established conventions.