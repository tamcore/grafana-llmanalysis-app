# AGENTS.md — Coding Standards & Conventions

## Project

Grafana LLM Analysis plugin (`tamcore-llmanalysis-app`) — an app plugin
with a Go backend that wires OpenAI-compatible LLM endpoints into Grafana
for infrastructure chat, dashboard analysis, metric queries, and log analysis.

**Repository:** <https://github.com/tamcore/grafana-llmanalysis-app>

## Development Rules

### Testing

- **100 % TDD** — write tests before implementation.
- Every Go package must have `_test.go` files.
- Frontend components must have Jest test files.
- Go tests run with `-race` in CI.

### Quality Gates

These must **always** pass before committing:

```bash
# Go
go fmt ./...
go vet ./...
golangci-lint run

# Frontend
npm run lint
npm test
```

Pre-commit hooks (`.pre-commit-config.yaml`) enforce the Go gates automatically.

### Commit Conventions

- **Semantic commits** — use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:` · `fix:` · `test:` · `docs:` · `chore:` · `refactor:` · `ci:` · `style:`
- **Small, reviewable chunks** — each commit should be focused and self-contained.
- Always include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.
- Reference GitHub issues in commit messages when applicable (`Closes #N`).

### Releases

- Only **v0.1.0** — do not create higher version tags.
- Releases are built by the **GitHub Actions release workflow** triggered by
  pushing a `v*` tag. Never run `goreleaser` locally.
- GoReleaser produces per-arch archives named `llmanalysis-app-<os>-<arch>.{zip,tar.gz}`.
  The directory inside the archive is `tamcore-llmanalysis-app` (the Grafana plugin ID).
- `plugin.json` version/date placeholders (`%VERSION%`, `%TODAY%`) are substituted
  by the release workflow.

### Security Patterns

The backend enforces several security controls — maintain these in new code:

| Control | Location | Detail |
|---------|----------|--------|
| Input sanitization | `security.go` | Rune-aware prompt truncation (10 k chars), control-char stripping |
| Context size limit | `security.go` | Rejects payloads > 512 KB |
| URL validation | `security.go` | `http`/`https` only, non-empty host (prevents SSRF) |
| Tool-result framing | `streaming.go` | Data-framing prefix on tool output to mitigate prompt injection |
| Rate limiting | `resources.go` | Per-user token-bucket (10 req/min) |
| Tool-call cap | `streaming.go`, `llm.go` | Max 25 rounds to prevent infinite loops |
| Sensitive field tags | `app.go` | `json:"-"` on API keys and token paths |

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18+, TypeScript 5.x, @grafana/ui |
| Backend | Go 1.22+, grafana-plugin-sdk-go |
| Build | Webpack 5 (frontend), GoReleaser v2 (release) |
| Testing | Jest + SWC (frontend), `go test -race` (backend) |
| Linting | ESLint (`@grafana/eslint-config`), golangci-lint |
| Dev env | Docker Compose (Grafana + hot-reload plugin mount) |

### Deployment

Two deployment paths exist under `deploy/`:

- **Plain Kubernetes manifests** (`deploy/*.yaml`) — Deployment, Service, Ingress, ConfigMaps.
- **Grafana Operator CRDs** (`deploy/operator/`) — `Grafana`, `GrafanaDatasource`,
  `GrafanaDashboard`, `GrafanaServiceAccount` resources.

Both use `GF_INSTALL_PLUGINS` to download the release zip at pod start.
Deploy manifests use `grafana.example.com` as a placeholder host — override for your environment.

**Important:** When the Grafana pod restarts with ephemeral storage, all
`GrafanaServiceAccount` tokens become invalid. Delete and re-create the
`GrafanaServiceAccount` CR, then wait ~60 s for kubelet to sync the new
secret into the pod volume.

### LLM Provider

- Any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, IONOS AI Model Hub,
  Ollama, vLLM, LiteLLM, etc.)
- Credentials stored in `.envrc` (gitignored, never committed).

### Work Tracking

- Use **GitHub Issues** for organising and tracking work tasks.
- Reference issues in commit messages when applicable.
