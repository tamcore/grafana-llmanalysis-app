package plugin

import (
	"encoding/json"

	openai "github.com/sashabaranov/go-openai"
)

// llmTools returns the set of tools exposed to the LLM for data queries.
func llmTools() []openai.Tool {
	return []openai.Tool{
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "query_prometheus",
				Description: "Execute a PromQL query against the Prometheus/VictoriaMetrics datasource and return current metric values. Use this when you need actual numeric data to answer questions about system state, performance, or resource usage.",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {
						"query": {
							"type": "string",
							"description": "PromQL expression, e.g. rate(node_cpu_seconds_total{mode=\"idle\"}[5m])"
						},
						"start": {
							"type": "string",
							"description": "Start time as RFC3339 or relative like 'now-1h'. Defaults to now-5m."
						},
						"end": {
							"type": "string",
							"description": "End time as RFC3339 or relative like 'now'. Defaults to now."
						},
						"step": {
							"type": "string",
							"description": "Query step interval, e.g. 15s, 1m, 5m. Defaults to 60s."
						}
					},
					"required": ["query"]
				}`),
			},
		},
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "query_loki",
				Description: "Execute a LogQL query against the Loki datasource and return log lines or metric results. Use this to search and analyze logs.",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {
						"query": {
							"type": "string",
							"description": "LogQL expression, e.g. {namespace=\"default\"} |= \"error\""
						},
						"start": {
							"type": "string",
							"description": "Start time as RFC3339 or relative like 'now-1h'. Defaults to now-1h."
						},
						"end": {
							"type": "string",
							"description": "End time as RFC3339 or relative like 'now'. Defaults to now."
						},
						"limit": {
							"type": "integer",
							"description": "Maximum number of log lines to return. Defaults to 100."
						}
					},
					"required": ["query"]
				}`),
			},
		},
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "list_datasources",
				Description: "List all configured Grafana datasources with their names, types, and UIDs. Use this to discover available data sources before querying.",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {},
					"required": []
				}`),
			},
		},
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "list_dashboards",
				Description: "List all Grafana dashboards with their titles, UIDs, and tags. Use this to discover available dashboards.",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {
						"query": {
							"type": "string",
							"description": "Optional search query to filter dashboards by name. Leave empty to list all."
						}
					},
					"required": []
				}`),
			},
		},
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "get_dashboard",
				Description: "Get a Grafana dashboard's full structure including all panels, queries, and variables. Use this to understand what a dashboard monitors before querying its metrics.",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {
						"uid": {
							"type": "string",
							"description": "Dashboard UID (from list_dashboards result)"
						}
					},
					"required": ["uid"]
				}`),
			},
		},
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "list_alerts",
				Description: "List currently firing or pending alerts from the Alertmanager datasource. Use this to check for active incidents, understand alert states, and correlate alerts with metrics/logs.",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {
						"filter": {
							"type": "string",
							"description": "Optional Alertmanager filter expression, e.g. severity=critical or namespace=default"
						},
						"state": {
							"type": "string",
							"description": "Filter by alert state: 'firing', 'pending', or 'inactive'. Leave empty for all."
						}
					},
					"required": []
				}`),
			},
		},
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "list_alert_rules",
				Description: "List all configured Grafana alert rules with their expressions, labels, and annotations. Use this to understand what alerting conditions are defined and investigate why alerts fired.",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {},
					"required": []
				}`),
			},
		},
	}
}

// ToolCallArgs holds parsed arguments for tool calls.
type PrometheusQueryArgs struct {
	Query string `json:"query"`
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`
	Step  string `json:"step,omitempty"`
}

type LokiQueryArgs struct {
	Query string `json:"query"`
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

// ListDashboardsArgs holds parsed arguments for list_dashboards.
type ListDashboardsArgs struct {
	Query string `json:"query,omitempty"`
}

// GetDashboardArgs holds parsed arguments for get_dashboard.
type GetDashboardArgs struct {
	UID string `json:"uid"`
}

// ListAlertsArgs holds parsed arguments for list_alerts.
type ListAlertsArgs struct {
	Filter string `json:"filter,omitempty"`
	State  string `json:"state,omitempty"`
}

// ListAlertRulesArgs holds parsed arguments for list_alert_rules.
type ListAlertRulesArgs struct {
	// No required parameters — returns all alert rules
}
