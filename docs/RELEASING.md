# Releasing to PyPI

Sponsifer publishes with PyPI's Trusted Publishing. No API token exists: when the release workflow runs, GitHub proves to PyPI over OIDC that this workflow, in this repository, made the upload. PyPI then attaches a Sigstore-signed attestation to every file, recording which commit and workflow built it. For a tool whose purpose is provenance, that is the right way to ship.

Everything is public and permanent once it reaches PyPI. A version number, once uploaded, can never be uploaded again, even after deletion. A bad release can be yanked, but not unpublished. That is why TestPyPI comes first.

## One-off setup (the maintainer's steps; nobody else can do these)

1. **Create two accounts, and turn on two-factor authentication for both.** One is at <https://pypi.org>, the other at <https://test.pypi.org>. They are separate services with separate accounts, and both require 2FA before you can publish.
2. **Register a pending publisher on each.** This goes under *Account settings → Publishing → Add a new pending publisher*:
   | Field | PyPI | TestPyPI |
   |---|---|---|
   | PyPI project name | `sponsifer` | `sponsifer` |
   | Owner | `idl3o` | `idl3o` |
   | Repository name | `sponsifer` | `sponsifer` |
   | Workflow name | `release.yml` | `release.yml` |
   | Environment name | `pypi` | `testpypi` |

   A pending publisher does not reserve the name. The first successful upload does.
3. **Create two GitHub environments.** These go under *Repository settings → Environments*: `testpypi` and `pypi`. On `pypi`, add yourself as a **required reviewer**. After that, a pushed tag builds and uploads to TestPyPI, then waits for your approval before anything reaches PyPI.

## Each release

1. Set the same version in `python/sponsifer/__init__.py` and `package.json`. The workflow refuses a tag that does not match both.
2. Push `main`. Then run *Actions → release → Run workflow*. This builds, runs every test, and publishes to **TestPyPI only**.
3. Install from TestPyPI as a user would, taking dependencies from the real index:
   ```bash
   pipx install --pip-args="--index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/" "sponsifer[seal]"
   sponsifer --version
   sponsifer            # the app should open
   ```
4. If that is right, tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
5. Approve the `pypi` deployment in the Actions tab. The release is then live at <https://pypi.org/p/sponsifer>, and anyone can install it with `pipx install "sponsifer[seal]"`.

## What the workflow checks before anything is uploaded

- typecheck, lint, vitest and pytest, which includes the SSHSIG interoperability tests against the runner's OpenSSH
- that the tag, the Python package and the app all carry the same version
- `twine check --strict` on the built files
- that the wheel actually contains the web app, since it is gitignored and only included deliberately
