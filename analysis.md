<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Analyse requirements and make a rough implementation plan, for a grafana plugin, which will be able to wire up openai compatible endpoints to grafana (Loki / Prometheus / dashboards) for analysis and such

A good implementation shape is an **App plugin with a backend component**, plus optional panel extensions, rather than a pure frontend plugin. That lets you securely store LLM credentials in `secureJsonData`, proxy requests server-side, and add extension points like “Explain this panel” or “Analyze this dashboard” without exposing secrets in the browser.[^1_1][^1_2][^1_3]

## Requirements

The plugin should support three core inputs: **dashboard context**, **Prometheus metrics context**, and **Loki log context**. Grafana already exposes these concepts through dashboard/panel data, data source queries, and plugin extensions; a panel explainer example shows the pattern for pulling dashboard metadata and streaming LLM output back into the UI.[^1_3][^1_4][^1_5]

It should also support **OpenAI-compatible endpoints**, not just OpenAI itself. That means the backend should accept a base URL, model name, API key or bearer token, and optional provider-specific headers, then relay chat/completion requests through Grafana’s proxy or backend so secrets stay server-side.[^1_6][^1_2][^1_1]

For analysis use cases, the plugin should work in at least four modes:

- Explain the current panel.
- Summarize a dashboard.
- Ask questions over selected Loki logs.
- Ask questions over selected Prometheus time-series or query results.


## Functional scope

A practical first version should include:

- A configuration page for endpoint URL, auth token, model, timeout, and rate limits.
- A query/analysis UI that can send selected dashboard context plus user prompts.
- Support for streaming responses in the UI.
- A “context builder” that packages panel data, dashboard metadata, active time range, and a small sampled result set from Loki/Prometheus.
- Output formats such as narrative summary, root-cause hints, and action items.

If you want the plugin to feel native in Grafana, the best fit is probably an **app plugin with extension points**. Grafana’s plugin model supports app, data source, and panel plugins, and the LLM plugin pattern shows how an app plugin can centralize LLM access and expose extension behavior to other Grafana components.[^1_7][^1_5][^1_3]

## Architecture

### Frontend

The frontend should provide:

- Settings UI for endpoint and auth.
- A dashboard-side “Analyze” action.
- A chat-like or report-like results view.
- Context selection controls, such as “use current panel”, “include related panels”, or “include last 15 minutes”.


### Backend

The backend should provide:

- Secret storage and retrieval via `secureJsonData`.
- Proxying to OpenAI-compatible APIs.
- Request normalization across providers.
- Streaming relay to the frontend.
- Optional caching and audit logging.

Grafana’s data proxy is the right mechanism when you need authenticated requests or want to keep secrets out of the browser.[^1_2][^1_6][^1_1]

### Data flow

1. User opens a dashboard or panel.
2. Plugin collects metadata and query results from Grafana context.
3. Backend formats a prompt with selected context.
4. Backend sends the request to the configured OpenAI-compatible endpoint.
5. Streamed or final output is shown in the plugin UI.

## Rough implementation plan

| Phase | Work | Deliverable |
| :-- | :-- | :-- |
| 1. Discovery | Define supported providers, auth methods, and analysis modes | Short spec and API contract |
| 2. Plugin skeleton | Generate Grafana app plugin with backend | Running plugin shell |
| 3. Configuration | Add endpoint, token, model, timeout, and test connection | Saved settings page |
| 4. Context ingestion | Pull dashboard/panel metadata and query outputs | Context builder module |
| 5. Provider adapter | Map generic request schema to OpenAI-compatible endpoint | Provider abstraction layer |
| 6. UI experience | Add analyze button, chat view, streaming output | Usable analysis UI |
| 7. Security | Harden secret handling, sanitize prompts, add allowlists | Safer production-ready behavior |
| 8. Observability | Add plugin logs, latency metrics, error reporting | Operability for admins |
| 9. Packaging | Build, sign, document, and publish | Installable plugin package |

## Key design choices

The biggest decision is whether you want the plugin to be **interactive analysis only** or also to **augment query workflows**. If the goal is to let users ask questions about dashboards, logs, and metrics, an app plugin is the broadest fit; if the goal is to embed AI directly into a single visualization, a panel plugin may be enough.[^1_4][^1_5][^1_3]

A second important choice is whether the plugin should query Loki/Prometheus directly or only consume data already present in Grafana panels. Direct querying gives better targeted context but adds complexity; panel-derived context is simpler and safer for an MVP because Grafana panels already encapsulate the relevant query results.[^1_8][^1_9][^1_3]

## MVP recommendation

For a first release, I’d build:

- One app plugin.
- One backend proxy.
- One “Analyze dashboard” page.
- One “Explain this panel” extension.
- One generic OpenAI-compatible client.

That gives you the shortest path to a useful product while keeping the architecture open for later additions like saved analyses, alert explanation, log summarization, and query-generation helpers.[^1_5][^1_3][^1_4]

If you want, I can turn this into a more concrete **technical design doc** with API shapes, plugin folder structure, and a milestone-by-milestone backlog.
<span style="display:none">[^1_10][^1_11][^1_12][^1_13][^1_14][^1_15][^1_16][^1_17][^1_18][^1_19][^1_20][^1_21][^1_22][^1_23][^1_24][^1_25][^1_26][^1_27][^1_28]</span>

<div align="center">⁂</div>

[^1_1]: https://grafana.com/developers/plugin-tools/how-to-guides/app-plugins/add-authentication-for-app-plugins

[^1_2]: https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/add-authentication-for-data-source-plugins

[^1_3]: https://grafana.com/grafana/plugins/grafana-llm-app/

[^1_4]: https://deepwiki.com/grafana/grafana-llmexamples-app/3-architecture

[^1_5]: https://www.youtube.com/watch?v=dzFkEAVwjGI

[^1_6]: https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/fetch-data-from-frontend

[^1_7]: https://grafana.com/grafana/plugins/data-source-plugins/

[^1_8]: https://grafana.com/docs/grafana/latest/datasources/loki/configure-loki-data-source/

[^1_9]: https://grafana.com/docs/grafana/latest/datasources/loki/

[^1_10]: https://www.youtube.com/watch?v=fOF-SmDU9zo

[^1_11]: https://grafana.com/grafana/plugins/

[^1_12]: https://github.com/grafana/tutorials/blob/master/content/tutorials/build-a-data-source-plugin.md

[^1_13]: https://github.com/grafana/grafanacon-custom-data-source-plugin

[^1_14]: https://deepwiki.com/grafana/grafana-llmexamples-app/4.3-panel-explainer\&rut=723c4d13e75dacd6d2c0ff5946136920dfd9f01f0402fd78f3df53a49e7f05db

[^1_15]: https://deepwiki.com/grafana/grafana-openai-monitoring/5-grafana-integration

[^1_16]: https://github.com/grafana/grafana-llm-app/issues/55

[^1_17]: https://oneuptime.com/blog/post/2026-01-21-loki-grafana-connection/view

[^1_18]: https://grafana.com/docs/grafana-cloud/monitor-infrastructure/integrations/integration-reference/integration-openai/

[^1_19]: https://grafana.com/blog/monitor-your-openai-usage-with-grafana-cloud/

[^1_20]: https://github.com/grafana/tutorials/blob/master/content/tutorials/build-an-app-plugin.md

[^1_21]: https://www.linkedin.com/posts/tomglenn_creating-an-openai-powered-panel-plugin-for-activity-7206657828034375683-scE6

[^1_22]: https://github.com/grafana/grafana/tree/main/docs/sources/tutorials/build-a-data-source-backend-plugin/index.md

[^1_23]: https://www.youtube.com/watch?v=zUubNiZ9au8

[^1_24]: https://roadie.io/backstage/plugins/grafana/

[^1_25]: https://pkg.go.dev/gopkg.in/grafana/grafana.v8/pkg/api/pluginproxy

[^1_26]: https://github.com/Grafana/Grafana-plugin-examples

[^1_27]: https://www.bookstack.cn/read/Grafana-8.2-en/80e81ec4aa919d92.md

[^1_28]: https://www.bookstack.cn/read/Grafana-v8.0-en/317e47ec6ff69eb2.md

