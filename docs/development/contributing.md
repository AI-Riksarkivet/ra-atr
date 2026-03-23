# Contributing

See [CONTRIBUTING.md](https://github.com/AI-Riksarkivet/ra-atr/blob/main/.github/CONTRIBUTING.md) for guidelines.

## Development Workflow

```bash
make check   # Format + lint + typecheck
make test    # Run all tests
make serve   # Start dev servers
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `refactor:` — Code restructure
- `test:` — Tests
- `chore:` — Maintenance
- `perf:` — Performance
- `ci:` — CI/CD

## Pre-commit Hooks

Install hooks:
```bash
pre-commit install
pre-commit install --hook-type commit-msg
```

Hooks run automatically on commit:
- Ruff format + lint
- Trailing whitespace cleanup
- Conventional commit message validation
