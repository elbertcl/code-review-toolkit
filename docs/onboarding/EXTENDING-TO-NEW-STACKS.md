# Extending to New Stacks (QA, Data, etc.)

The toolkit ships org profiles for `backend` and `frontend`. This guide covers
adding profiles for new stacks.

## When to Extend

Add new org profiles when onboarding repos in a stack that has different:
- Security concerns (e.g. data pipeline access patterns)
- SRE/reliability standards (e.g. batch job monitoring)
- Coding conventions (e.g. SQL dialect rules)

If the new repos are still Go or TS/React, the existing profiles likely suffice.
Only create new profiles when the stack has genuinely different governance rules.

## Steps

### 1. Create org profile files

```
opencode-review/context/contexts/<stack>/security.md
opencode-review/context/contexts/<stack>/sre.md
```

Format:
```markdown
mandatory_rule_ids: [ORG-<STACK>-SEC-001, ORG-<STACK>-SRE-001]

# <Stack> Security Profile

- **ORG-<STACK>-SEC-001:** <rule description>. Source: <where this rule comes from>. Owner: Security.
```

### 2. Register in the allowlist

In `opencode-review/src/context/lib/review-manifest.ts`, add entries to
`ORGANIZATION_PROFILE_ALLOWLIST`:

```typescript
export const ORGANIZATION_PROFILE_ALLOWLIST = Object.freeze({
  "backend/security": "backend/security.md",
  "backend/sre": "backend/sre.md",
  "frontend/security": "frontend/security.md",
  "frontend/sre": "frontend/sre.md",
  "<stack>/security": "<stack>/security.md",   // <-- add
  "<stack>/sre": "<stack>/sre.md",             // <-- add
});
```

### 3. Build and commit

```bash
npm run typecheck
npm run build
git add opencode-review/src/ opencode-review/dist/ opencode-review/context/
git commit -m "feat: add <stack> org profiles"
```

### 4. Tag a release

The `@v4` alias tracks the latest tag. After merge:
```bash
git tag v4.X.0
git push origin v4.X.0
# Move the v4 major tag:
git tag -f v4 v4.X.0
git push origin v4 --force
```

### 5. Consumer repos use the new profiles

```yaml
with:
  org_profiles: <stack>/security,<stack>/sre
```

## Checklist

- [ ] Profile files created with `mandatory_rule_ids` frontmatter
- [ ] Allowlist updated in `review-manifest.ts`
- [ ] Tests pass (`npm test`)
- [ ] dist rebuilt (`npm run build`)
- [ ] Tagged release published
- [ ] Consumer workflow updated with new `org_profiles` value
