# Contributing to Drast

Drast is an early-stage, Saudi-focused financial research prototype. Its work includes source collection, reviewable financial evidence, deterministic calculations, and draft reports requiring human verification.

## Scope and current licensing status

This repository is publicly visible but does **not** currently publish a project-wide open-source license. Public visibility alone does not grant permission to reuse or redistribute its code. Licensing and the rights of any bundled components must be reviewed by the maintainer before a broader open-source release.

Contributions are welcome for discussion and review, but please open an issue first and agree on the scope and applicable licensing before investing in significant code changes.

## What to work on

Useful contributions include:
- Reproducible issues in source collection or evidence attribution.
- Correctness and regression tests for financial periods, units, missing values, and citations.
- Accessibility, Arabic/right-to-left UX, documentation, and error-handling fixes.
- Security improvements that do not expose vulnerabilities publicly.

Avoid unrelated feature expansion or changes to live deployments, databases, or API billing.

## Local checks

Requirements: Node.js 22+ and pnpm as defined in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
```

These commands describe the expected contributor checks; their presence here does not claim the current branch has passed them.

## Submitting a contribution

1. Open an issue explaining the problem, expected behavior, and proposed minimal fix.
2. Work on a separate branch; keep pull requests small and link the issue.
3. Explain the code changed, tests run, and any checks you could not perform.
4. Include source citations for financial facts and screenshots for UI changes where useful.
5. Do not commit credentials, private customer information, production data, or licensed documents without redistribution permission.
6. Preserve the deterministic financial engine's boundaries: AI-generated text must not silently become verified financial data.

Maintainers review correctness, source traceability, security, and backward compatibility before accepting a change.

## Reporting a security issue

Do not disclose credentials or exploitable details in a public issue. Contact the repository maintainer privately to coordinate responsible disclosure.
