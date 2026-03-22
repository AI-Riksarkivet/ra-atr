# Code Quality Tooling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add prettier-plugin-svelte, eslint, vitest, lefthook, and knip to the lejonet frontend, plus fix stale doc paths.

**Architecture:** All quality tools install into `frontend/` as devDependencies. Lefthook config lives at repo root (it's a git hook manager). Makefile gets updated quality targets.

**Tech Stack:** prettier, eslint (flat config), vitest, lefthook, knip

---

### Task 1: Fix prettier for Svelte files

**Files:**
- Create: `frontend/.prettierrc`
- Modify: `frontend/package.json` (add devDependency)

**Step 1: Install prettier-plugin-svelte**

```bash
cd frontend && npm install -D prettier prettier-plugin-svelte
```

**Step 2: Create .prettierrc**

```json
{
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [
    {
      "files": "*.svelte",
      "options": {
        "parser": "svelte"
      }
    }
  ],
  "singleQuote": true,
  "tabWidth": 2,
  "printWidth": 100,
  "trailingComma": "all",
  "useTabs": true
}
```

**Step 3: Verify prettier works on .svelte files**

```bash
cd frontend && npx prettier --check "src/**/*.svelte"
```

Expected: Either all pass, or lists files needing formatting (no parser errors).

**Step 4: Format all files**

```bash
cd frontend && npx prettier --write "src/**/*.{svelte,ts,js,css}"
```

**Step 5: Commit**

```bash
git add frontend/.prettierrc frontend/package.json frontend/package-lock.json frontend/src/
git commit -m "chore: add prettier-plugin-svelte and format all files"
```

---

### Task 2: Add ESLint with Svelte plugin

**Files:**
- Create: `frontend/eslint.config.js`
- Modify: `frontend/package.json` (add devDependencies)

**Step 1: Install eslint and svelte plugin**

```bash
cd frontend && npm install -D eslint @eslint/js eslint-plugin-svelte typescript-eslint globals
```

**Step 2: Create eslint.config.js**

```javascript
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    ignores: [
      '.svelte-kit/',
      'build/',
      'node_modules/',
      '.storybook/',
      'storybook-static/',
    ],
  },
);
```

**Step 3: Run eslint**

```bash
cd frontend && npx eslint src/
```

Expected: Runs without crashing. May report warnings/errors to fix.

**Step 4: Fix any auto-fixable issues**

```bash
cd frontend && npx eslint src/ --fix
```

**Step 5: Add lint script to package.json**

Add to `scripts`:
```json
"lint": "eslint src/",
"lint:fix": "eslint src/ --fix"
```

**Step 6: Commit**

```bash
git add frontend/eslint.config.js frontend/package.json frontend/package-lock.json frontend/src/
git commit -m "chore: add eslint with svelte and typescript plugins"
```

---

### Task 3: Add Vitest

**Files:**
- Modify: `frontend/package.json` (add devDependency + script)

**Step 1: Install vitest**

```bash
cd frontend && npm install -D vitest
```

**Step 2: Add test script to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Verify vitest runs (no tests yet is OK)**

```bash
cd frontend && npx vitest run
```

Expected: `No test files found` or similar — no crash.

**Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add vitest"
```

---

### Task 4: Add Knip

**Files:**
- Create: `frontend/knip.json`
- Modify: `frontend/package.json` (add devDependency + script)

**Step 1: Install knip**

```bash
cd frontend && npm install -D knip
```

**Step 2: Create knip.json**

```json
{
  "$schema": "https://unpkg.com/knip@latest/schema.json",
  "entry": ["src/**/*.ts", "src/**/*.svelte"],
  "project": ["src/**/*.ts", "src/**/*.svelte"],
  "ignore": [".svelte-kit/**"],
  "ignoreDependencies": ["tw-animate-css"]
}
```

**Step 3: Add script to package.json**

Add to `scripts`:
```json
"knip": "knip"
```

**Step 4: Run knip**

```bash
cd frontend && npx knip
```

Expected: Reports unused deps/exports. Review output — may need to add entries to `ignoreDependencies` for framework magic.

**Step 5: Commit**

```bash
git add frontend/knip.json frontend/package.json frontend/package-lock.json
git commit -m "chore: add knip for dead code detection"
```

---

### Task 5: Add Lefthook

**Files:**
- Create: `lefthook.yml` (repo root)

**Step 1: Install lefthook**

```bash
npm install -g lefthook  # or: brew install lefthook
lefthook install
```

**Step 2: Create lefthook.yml at repo root**

```yaml
pre-commit:
  parallel: false
  commands:
    prettier:
      root: frontend/
      glob: "*.{svelte,ts,js,css}"
      run: npx prettier --check {staged_files}
    eslint:
      root: frontend/
      glob: "*.{svelte,ts,js}"
      run: npx eslint {staged_files}
    svelte-check:
      root: frontend/
      run: npx svelte-check --threshold error
```

**Step 3: Test the hook**

```bash
echo "const x = 1" > frontend/src/test-hook.ts
git add frontend/src/test-hook.ts
git commit -m "test: hook test"
```

Expected: Commit blocked by eslint (unused variable) or prettier.

**Step 4: Clean up test file**

```bash
rm frontend/src/test-hook.ts
```

**Step 5: Commit lefthook config**

```bash
git add lefthook.yml
git commit -m "chore: add lefthook pre-commit hooks"
```

---

### Task 6: Update Makefile

**Files:**
- Modify: `Makefile`

**Step 1: Update quality and add lint target**

Replace the `quality` target and add `lint`:

```makefile
## lint: run eslint
lint:
	cd frontend && npx eslint src/

## quality: run all quality checks
quality:
	cd frontend && npx prettier --check "src/**/*.{svelte,ts,js,css}"
	cd frontend && npx eslint src/
	cd frontend && npx svelte-check --threshold error
```

**Step 2: Verify**

```bash
make lint
make quality
```

Expected: Both run without errors.

**Step 3: Commit**

```bash
git add Makefile
git commit -m "chore: update Makefile with lint and quality targets"
```

---

### Task 7: Fix stale documentation

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `.env.example`

**Step 1: Fix frontend.md paths**

Add `frontend/` prefix to all file paths in the Key Modules, Workers, and Components sections. For example:
- `src/lib/stores/app-state.svelte.ts` → `frontend/src/lib/stores/app-state.svelte.ts`

**Step 2: Add GPU_SERVER_URL to .env.example**

Add under the GPU Server section:
```
# GPU Server proxy target (dev server only, not Vite env var)
# GPU_SERVER_URL=http://localhost:8080
```

**Step 3: Commit**

```bash
git add docs/architecture/frontend.md .env.example
git commit -m "docs: fix stale paths and missing env var"
```
