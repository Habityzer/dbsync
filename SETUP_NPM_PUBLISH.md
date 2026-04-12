# Setting Up Automated NPM Publishing

This project uses GitHub Actions with [semantic-release](https://semantic-release.gitbook.io/) (via [`cycjimmy/semantic-release-action@v6`](https://github.com/cycjimmy/semantic-release-action)) to automatically publish to npm when you push to **`main`** or **`master`**.

## Setup Instructions

### 1. Create NPM Access Token

> **Important**: As of December 9, 2025, npm classic tokens have been permanently revoked. You must use **granular access tokens** for CI/CD workflows.

**Option A: Using npm CLI (recommended):**
```bash
npm token create --type automation
```

For the **first automated publish**, granular tokens often cannot target a package name that does not exist on npm yet. In that case choose **All packages** (read and write) for the token, publish once from CI, then you can narrow the token to **`db-sync-tool`** only. If the package already exists under your npm user, you can restrict the token to **`db-sync-tool`** from the start.

**Option B: Using the web interface:**
1. Go to [npmjs.com/settings/~/tokens](https://www.npmjs.com/settings/~/tokens) and log in
2. Click **Generate New Token** → **Granular Access Token**
3. Configure your token:
   - **Token name**: `github-actions-dbsync` (or any descriptive name)
   - **Expiration**: Up to 90 days (maximum for publish tokens)
   - **Packages and scopes**: Select **`db-sync-tool`** (or **All packages** if you prefer)
   - **Permissions**: Select **Read and write**
   - ✅ **Enable "Bypass 2FA"** for automated workflows
4. Click **Generate Token**
5. Copy the token (starts with `npm_...`)

> **Note**: Granular tokens for publishing expire after a maximum of 90 days. Set a reminder to regenerate the token before expiration.

### 2. Add NPM Token to GitHub

1. Go to your GitHub repository: https://github.com/Habityzer/dbsync
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `NPM_TOKEN`
5. Value: Paste your npm token from step 1
6. Click **Add secret**

### 3. How It Works

The workflow (`.github/workflows/publish.yml`) will:

1. **Trigger**: Automatically runs when you push to **`main`** or **`master`**
2. **Analyze**: Semantic-release reads your commit messages (following conventional commits)
3. **Version**: Automatically bumps the version based on your commits:
   - `feat:` → minor version (1.0.0 → 1.1.0)
   - `fix:` → patch version (1.0.0 → 1.0.1)
   - `BREAKING CHANGE:` → major version (1.0.0 → 2.0.0)
4. **Changelog**: Updates `CHANGELOG.md`
5. **Git Tag**: Creates a git tag for the new version
6. **Publish**: Publishes to npm
7. **Commit**: Commits the changelog and version bump back to your repo

Releases run only in CI (not via a local `pnpm release` script).

### 4. Commit Message Format

Use conventional commits for automatic versioning:

```bash
# Patch release (1.0.0 → 1.0.1)
git commit -m "fix: resolve backup path bug"

# Minor release (1.0.0 → 1.1.0)
git commit -m "feat: add retention option"

# Major release (1.0.0 → 2.0.0)
git commit -m "feat: redesign CLI

BREAKING CHANGE: command flags have changed"

# No release (documentation, etc.)
git commit -m "docs: update README"
git commit -m "chore: update dependencies"
```

## Troubleshooting

### "No NPM_TOKEN found"
- Make sure you've added `NPM_TOKEN` as a GitHub secret
- Check that the secret name is exactly `NPM_TOKEN` (case-sensitive)

### "No release published"
- Check your commit messages follow conventional commits format
- Semantic-release only publishes if there are releasable commits
- View the GitHub Actions logs for details

### "Invalid npm token" / `SemanticReleaseError: Invalid npm token`

This comes from npm’s auth check (`npm whoami`) before publish. Fix it on the npm + GitHub side (the workflow is already passing `NPM_TOKEN` / `NODE_AUTH_TOKEN`).

1. **Secret value** — In the repo (or org) **Settings → Secrets and variables → Actions**, open `NPM_TOKEN` and replace it with a **new** granular token. Typos, extra spaces, or an old classic token will fail.

2. **Same npm account as the package** — The token must belong to the npm user (or org) that is allowed to publish **`db-sync-tool`**. If the name is owned by someone else, publishing will fail until you use another package name or get access.

3. **Granular token + first publish** — You often **cannot** pick a not-yet-published package in the UI. Use **All packages** with **Read and write** and **Bypass 2FA** for the first release, then tighten the token to `db-sync-tool` if you want.

4. **Organization / Habityzer** — If `NPM_TOKEN` is an **organization** secret, confirm this repository is **allowed** to use it. If it’s only a **repository** secret, it must be defined on **`Habityzer/dbsync`**, not only on another repo.

5. **Verify locally** (optional):
   ```bash
   NPM_TOKEN=npm_xxxxx npm whoami --registry https://registry.npmjs.org/
   ```
   You should see your npm username. If this fails, fix the token before pushing again.

6. **Expiry** — Granular publish tokens can expire (often within 90 days). Generate a new one and update the GitHub secret.

### "Package already published"
- Semantic-release automatically handles versions
- If you manually published the same version, semantic-release will skip it

## Current Configuration

- **Branches**: `main` and `master` (see `.releaserc.json` and `.github/workflows/publish.yml` `on.push.branches`)
- **Package**: `db-sync-tool`
- **Workflow**: `.github/workflows/publish.yml`
- **NPM Publish**: Enabled (set in `.releaserc.json`)

## Additional Resources

- [npm Granular Access Tokens Documentation](https://docs.npmjs.com/about-access-tokens#granular-access-tokens)
- [Semantic Release Documentation](https://semantic-release.gitbook.io/)
- [Conventional Commits](https://www.conventionalcommits.org/)
