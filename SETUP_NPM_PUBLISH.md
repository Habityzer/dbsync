# Setting Up Automated NPM Publishing

This project uses GitHub Actions with [semantic-release](https://semantic-release.gitbook.io/) (via [`cycjimmy/semantic-release-action@v6`](https://github.com/cycjimmy/semantic-release-action)) to publish to npm on push to **`main`** or **`master`**.

## Recommended: npm Trusted Publishing (OIDC)

This is the **default** for this repo. It uses short-lived OpenID Connect credentials from GitHub Actions instead of a long-lived **`NPM_TOKEN`**, so you avoid **EOTP**, token rotation, and leaked publish tokens.

### Requirements

- Workflow file **`.github/workflows/publish.yml`** (exact filename — npm matches this string).
- GitHub-hosted runners (not self-hosted).
- **`id-token: write`** on the job (already set in this repo).
- **`package.json`** `repository.url` must match this GitHub repo (see [npm docs](https://docs.npmjs.com/trusted-publishers/)).
- npm CLI **≥ 11.5.1** in CI (the workflow upgrades npm before release).

### One-time setup on npmjs.com

1. Open **[@habityzer/db-sync-tool → Package settings](https://www.npmjs.com/package/@habityzer/db-sync-tool/access)** (create the scoped package under the **Habityzer** npm org if needed; you need publish access on that org).
2. Find **Trusted publishing** and choose **GitHub Actions**.
3. Set:
   - **Repository**: `Habityzer/dbsync` (owner/repo, case-sensitive).
   - **Workflow filename**: `publish.yml` (only the name, with `.yml`).
4. Save.

After this works, you can **remove** any **`NPM_TOKEN`** repository secret — it is no longer needed for publish.

### Private npm dependencies (optional)

Trusted publishing only authenticates **`npm publish`**. If you later add **private** packages, use a **read-only** granular token for `pnpm install` only (see [npm docs](https://docs.npmjs.com/trusted-publishers/#handling-private-dependencies)).

---

## Legacy: automation token (fallback)

Use this only if Trusted Publishing is **not** configured yet, or while migrating.

1. Create a granular **Automation** token: `npm token create --type automation`, or on the website choose **Automation** (not Publish-only — Publish-only causes **`EOTP`** in CI).
2. Add **`NPM_TOKEN`** in GitHub → **Settings** → **Secrets and variables** → **Actions**.
3. **`@semantic-release/npm`** tries OIDC first; if the npm exchange succeeds, the secret is ignored. If not, it falls back to **`NPM_TOKEN`**.

---

## How it works

The workflow (`.github/workflows/publish.yml`):

1. **Trigger**: Push to **`main`** or **`master`**
2. **Analyze**: Conventional commits via semantic-release
3. **Version**: Bumps semver from commits (`feat` → minor, `fix` → patch, etc.)
4. **Changelog**: Updates `CHANGELOG.md`
5. **Publish**: npm (OIDC preferred, token fallback)
6. **Git / GitHub**: Tag, changelog commit, GitHub release

---

## Commit message format

```bash
git commit -m "fix: resolve backup path bug"   # patch
git commit -m "feat: add retention option"     # minor
# major: include BREAKING CHANGE in body
```

---

## Troubleshooting

### `Unable to authenticate` / OIDC / `ENEEDAUTH`

- On npm, confirm **Trusted publishing** matches **`Habityzer/dbsync`** and workflow name **`publish.yml`** (case-sensitive).
- Confirm **`package.json`** `repository.url` is **`git+https://github.com/Habityzer/dbsync.git`**.
- Re-run uses the same checks; fix the npm/GitHub link, not only the workflow.

### `npm error code EOTP`

You are on **legacy token** path with a **non-Automation** token. Prefer **Trusted Publishing** above, or replace the secret with an **Automation** granular token.

### `ENONPMTOKEN` / `Invalid npm token`

- Enable Trusted Publishing on npm **or** set a valid **`NPM_TOKEN`**.
- Ensure **`@semantic-release/npm@^13.1.3`** (already pinned in the workflow `extra_plugins`).

### Organization / secrets

If **`NPM_TOKEN`** is an org secret, grant this repository access. Environment secrets require `environment: …` on the job in **`publish.yml`**.

---

## Additional resources

- [Trusted publishing (npm)](https://docs.npmjs.com/trusted-publishers/)
- [Semantic release](https://semantic-release.gitbook.io/)
- [Conventional commits](https://www.conventionalcommits.org/)
