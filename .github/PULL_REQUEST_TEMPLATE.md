## Summary

<!-- What changed and why? 2-3 sentences max. -->

## Type

<!-- Check exactly one. -->

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] security — security hardening or vulnerability patch
- [ ] infra — Terraform / Docker / CI-CD change
- [ ] chore — refactor, deps update, or housekeeping

## Security checklist

- [ ] No secrets, credentials, or API keys committed
- [ ] All user-supplied inputs are validated before use
- [ ] No new dependencies added without checking for known CVEs (`pip-audit` / `npm audit`)
- [ ] CORS, auth, and rate-limit behaviour unchanged (or explicitly reviewed)

## Test plan

<!-- How did you verify this change works? Describe manual steps or automated test coverage. -->

- [ ] CI passes (backend lint, frontend build, docker smoke test)
- [ ] Relevant unit/integration tests added or updated
- [ ] Tested locally against the dev environment
