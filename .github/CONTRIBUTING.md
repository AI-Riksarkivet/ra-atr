# Contributing to Lejonet HTR

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `make setup`
4. Create a feature branch: `git checkout -b feat/my-feature`

## Development Workflow

```bash
make quality   # Format + typecheck
make test      # Run tests
make dev       # Start dev server
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
refactor: restructure code
test: add tests
chore: maintenance
```

## Pull Requests

1. Ensure `make quality` passes
2. Ensure `make test` passes
3. Update documentation if needed
4. Submit PR against `main` branch

## Code Style

- **TypeScript/Svelte**: prettier, Svelte 5 runes
