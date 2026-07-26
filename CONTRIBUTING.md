## Development (working on this repo)

### Setup

```bash
yarn install
yarn build           # Builds both library and CLI
```

Use **yarn**, not npm. The committed lockfile is `yarn.lock` and CI runs
`yarn install --frozen-lockfile`; installing with npm drifts the lockfile and
breaks the build.

### Build commands

```bash
yarn build             # Full build (library + CLI)
yarn build:lib         # Library only
yarn build:cli         # CLI only
```

### Publishing a new version

Releases are automated. On merge to `main`, the Release workflow
(`.github/workflows/release.yml`) consumes any pending changesets, bumps the
version, updates the changelog, and publishes to npm over OIDC. No npm token is
involved — the repository publishes itself via a trusted publisher.

To cut a release:

1. In your PR, add a changeset and pick the bump level (patch / minor / major):

   ```bash
   yarn changeset
   ```

   This writes a file under `.changeset/`. Choosing the bump level is the manual
   part of the release; anyone can do it in a PR without a token.

2. Merge to `main`. The workflow versions and publishes the new release.

#### Manual publish (break-glass only)

Only if CI is unavailable. This needs an npm token and a clean changeset state
(no pending `.changeset/*.md`, or the next merge double-bumps). From `main` with
a clean tree:

```bash
yarn changeset version                 # bump package.json + changelog
yarn build && yarn changeset publish   # prepublishOnly runs the full build
git commit -am "chore(release): @thatopen/services <version>" && git push
```
