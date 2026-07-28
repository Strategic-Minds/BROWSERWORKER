# UACS Sandbox Integration

BrowserWorker is a mandatory validation dependency for the UACS autonomous coding sandbox.

## Consumer

`Strategic-Minds/UNIVERSAL-AUTONOMOUS-CODING-SYSTEM-SANDBOX`

## Canonical promotion target

`Strategic-Minds/UNIVERSAL-AUTONOMOUS-CODING-SYSTEM`

## Enforcement

A sandbox candidate cannot become promotable unless BrowserWorker returns a passed receipt containing desktop, tablet, and mobile screenshots, per-breakpoint visual parity scores of at least 99%, operational parity of exactly 100%, zero console errors, zero network errors, and a rollback reference.

BrowserWorker evidence supplements repository-local Playwright tests. It does not replace lint, type-check, build, unit, integration, accessibility, security, or data-integrity checks.

## Failure behavior

- Missing evidence: block promotion.
- Deep-health failure: block promotion.
- Visual score below 99% at any required breakpoint: return to visual repair.
- Operational score below 100%: return to the smallest failing functional layer.
- More than five repair attempts: escalate to the operator.
- Production action: always require operator approval.

The machine-readable contract is `contracts/uacs-sandbox.validation.json`.
