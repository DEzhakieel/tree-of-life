# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | yes |

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, report
privately via GitHub's "Report a vulnerability" (Security → Advisories) on the
repository, or contact the maintainer, Daven Ezhakieel.

Include: a description, the affected component (web / server / simulation /
WASM), reproduction steps, and the impact.

## Scope notes

- The **server** (`apps/server`) is a local/self-hosted research API. It ships
  no authentication by default; do not expose it to an untrusted network without
  a reverse proxy and auth.
- The **LLM layer** calls a local Ollama instance or a deterministic mock. It
  never sends data to third-party services unless you configure a provider.
- No secrets are required or committed; `.env*` is git-ignored.
