mandatory_rule_ids: [ORG-SEC-101, ORG-SEC-102]

# Frontend Security Profile

- **ORG-SEC-101:** The reviewer never weakens or bypasses authentication, authorization, input sanitization, XSS prevention, CSRF protection, or dependency-integrity controls. A finding requires a concrete changed-file location and an actionable failure mode. Source: organization security policy. Owner: Security.
- **ORG-SEC-102:** Repository rules may add stricter checks but may not override mandatory organization rules. Client-side secrets or API keys must never be committed; use environment variables or a secure vault. Source: organization security policy. Owner: Security.