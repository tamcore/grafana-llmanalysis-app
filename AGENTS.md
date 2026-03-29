# AGENTS.md — Coding Standards & Conventions

## Project

Grafana LLM plugin — an app plugin with Go backend that wires OpenAI-compatible
LLM endpoints into Grafana for dashboard/panel analysis, Prometheus metrics
analysis, and Loki log analysis.

**Repository:** <https://github.com/tamcore/grafana-llm>

## Development Rules

### Testing

- **100% TDD** — write tests before implementation.
- Every Go package must have `_test.go` files.
- Frontend components must have Jest test files.
- E2E tests use Playwright.

### Go Quality Gates

These must **always** pass before committing:

```bash
go fmt ./...
go vet ./...
golangci-lint run
```

### Commit Conventions

- **Semantic commits** — use [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` new feature
  - `fix:` bug fix
  - `test:` adding or updating tests
  - `docs:` documentation only
  - `chore:` maintenance, tooling, dependencies
  - `refactor:` code change that neither fixes a bug nor adds a feature
  - `ci:` CI/CD changes
  - `style:` formatting, no code change
- **Small, reviewable chunks** — each commit should be focused and self-contained.
- Always include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.

### LLM Provider

- **Provider:** IONOS Cloud AI Model Hub (OpenAI-compatible)
- **Model:** `gpt-oss120b`
- **Base URL:** `https://openai.inference.de-txl.ionos.com/v1`
- Credentials stored in `.enrvrc` (not committed).

### Kubernetes Testing

- **Context:** `foo`
- **Ingress host:** `grafana.85.215.177.78.nip.io`
- **Ingress class:** `nginx`
- **TLS:** `cert-manager.io/cluster-issuer: letsencrypt-prod`

### Technology Stack

| Layer     | Technology                                   |
| --------- | -------------------------------------------- |
| Frontend  | React 18+, TypeScript 5.x, @grafana/ui      |
| Backend   | Go 1.22+, grafana-plugin-sdk-go, Mage build |
| Build     | Webpack 5 (frontend), Mage (backend)         |
| Testing   | Jest (unit), go test (unit), Playwright (E2E)|
| Dev env   | Docker Compose                               |

### Work Tracking

- Use **GitHub Issues** for organizing and tracking work tasks.
- Each phase of work gets its own issue(s).
- Reference issues in commit messages when applicable.
