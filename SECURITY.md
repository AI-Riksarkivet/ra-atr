# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/AI-Riksarkivet/ra-atr/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and what you expected. A proof of concept helps but is
not required. We aim to acknowledge within a week.

## Scope

In scope: the browser application in `frontend/`, the static container image
(`.docker/frontend.dockerfile`), the Hugging Face Space build in `space/`, the Helm chart in
`charts/` and the CI workflows.

Not in scope here: the models themselves and the Hugging Face repositories they are
downloaded from.

## What the automated checks already cover

- **CodeQL** analyses the TypeScript and Svelte code on every push and pull request
  (`.github/workflows/codeql.yml`).
- **TruffleHog** scans for leaked credentials on every push (`.github/workflows/trufflehog.yml`),
  alongside GitHub's own secret scanning.
- **Dependabot** raises weekly version updates for the frontend lockfile, the actions and the
  base images (`.github/dependabot.yml`), and security updates as advisories are published.
- **OpenSSF Scorecard** grades the repository's supply-chain posture weekly
  (`.github/workflows/scorecard.yml`).

Actions are pinned by commit SHA, base images by digest, and frontend dependencies by
lockfile.
