package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ToolExecutor executes tool calls by querying Grafana datasources.
type ToolExecutor struct {
	grafanaURL     string
	httpClient     *http.Client
	defaultHeaders map[string]string
}

// NewToolExecutor creates a new tool executor.
// grafanaURL is the internal Grafana URL (e.g. http://localhost:3000).
// authHeaders are forwarded to authenticate datasource proxy requests.
func NewToolExecutor(grafanaURL string) *ToolExecutor {
	return &ToolExecutor{
		grafanaURL: strings.TrimSuffix(grafanaURL, "/"),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// Execute runs a tool call and returns the result as a string.
func (te *ToolExecutor) Execute(ctx context.Context, name string, arguments string, headers map[string]string) (string, error) {
	switch name {
	case "query_prometheus":
		return te.queryPrometheus(ctx, arguments, headers)
	case "query_loki":
		return te.queryLoki(ctx, arguments, headers)
	case "list_datasources":
		return te.listDatasources(ctx, headers)
	default:
		return "", fmt.Errorf("unknown tool: %s", name)
	}
}

func (te *ToolExecutor) queryPrometheus(ctx context.Context, arguments string, headers map[string]string) (string, error) {
	var args PrometheusQueryArgs
	if err := json.Unmarshal([]byte(arguments), &args); err != nil {
		return "", fmt.Errorf("parse prometheus args: %w", err)
	}

	if args.Query == "" {
		return "", fmt.Errorf("query is required")
	}

	// Find the first Prometheus-type datasource
	dsUID, err := te.findDatasource(ctx, headers, "prometheus")
	if err != nil {
		return "", fmt.Errorf("find prometheus datasource: %w", err)
	}

	// Build query parameters
	params := url.Values{}
	params.Set("query", args.Query)

	if args.Step == "" {
		args.Step = "60s"
	}
	params.Set("step", args.Step)

	now := time.Now()
	if args.Start == "" {
		params.Set("start", fmt.Sprintf("%d", now.Add(-5*time.Minute).Unix()))
	} else {
		params.Set("start", resolveTime(args.Start, now))
	}
	if args.End == "" {
		params.Set("end", fmt.Sprintf("%d", now.Unix()))
	} else {
		params.Set("end", resolveTime(args.End, now))
	}

	apiPath := fmt.Sprintf("/api/datasources/proxy/uid/%s/api/v1/query_range?%s", dsUID, params.Encode())
	return te.doGrafanaRequest(ctx, http.MethodGet, apiPath, nil, headers)
}

func (te *ToolExecutor) queryLoki(ctx context.Context, arguments string, headers map[string]string) (string, error) {
	var args LokiQueryArgs
	if err := json.Unmarshal([]byte(arguments), &args); err != nil {
		return "", fmt.Errorf("parse loki args: %w", err)
	}

	if args.Query == "" {
		return "", fmt.Errorf("query is required")
	}

	dsUID, err := te.findDatasource(ctx, headers, "loki")
	if err != nil {
		return "", fmt.Errorf("find loki datasource: %w", err)
	}

	params := url.Values{}
	params.Set("query", args.Query)

	now := time.Now()
	if args.Start == "" {
		params.Set("start", fmt.Sprintf("%d", now.Add(-1*time.Hour).UnixNano()))
	} else {
		params.Set("start", resolveTime(args.Start, now))
	}
	if args.End == "" {
		params.Set("end", fmt.Sprintf("%d", now.UnixNano()))
	} else {
		params.Set("end", resolveTime(args.End, now))
	}

	limit := args.Limit
	if limit <= 0 {
		limit = 100
	}
	params.Set("limit", fmt.Sprintf("%d", limit))

	apiPath := fmt.Sprintf("/api/datasources/proxy/uid/%s/loki/api/v1/query_range?%s", dsUID, params.Encode())
	return te.doGrafanaRequest(ctx, http.MethodGet, apiPath, nil, headers)
}

func (te *ToolExecutor) listDatasources(ctx context.Context, headers map[string]string) (string, error) {
	body, err := te.doGrafanaRequest(ctx, http.MethodGet, "/api/datasources", nil, headers)
	if err != nil {
		return "", err
	}

	// Parse and return only relevant fields
	var datasources []struct {
		Name string `json:"name"`
		Type string `json:"type"`
		UID  string `json:"uid"`
		URL  string `json:"url"`
	}
	if err := json.Unmarshal([]byte(body), &datasources); err != nil {
		return body, nil //nolint:nilerr // Return raw body if parsing fails
	}

	type dsSummary struct {
		Name string `json:"name"`
		Type string `json:"type"`
		UID  string `json:"uid"`
	}
	summaries := make([]dsSummary, len(datasources))
	for i, ds := range datasources {
		summaries[i] = dsSummary{Name: ds.Name, Type: ds.Type, UID: ds.UID}
	}

	out, _ := json.Marshal(summaries)
	return string(out), nil
}

func (te *ToolExecutor) findDatasource(ctx context.Context, headers map[string]string, dsType string) (string, error) {
	body, err := te.doGrafanaRequest(ctx, http.MethodGet, "/api/datasources", nil, headers)
	if err != nil {
		return "", err
	}

	var datasources []struct {
		Type string `json:"type"`
		UID  string `json:"uid"`
	}
	if err := json.Unmarshal([]byte(body), &datasources); err != nil {
		return "", fmt.Errorf("parse datasources: %w", err)
	}

	for _, ds := range datasources {
		if ds.Type == dsType {
			return ds.UID, nil
		}
	}

	return "", fmt.Errorf("no datasource of type %q found", dsType)
}

func (te *ToolExecutor) doGrafanaRequest(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (string, error) {
	reqURL := te.grafanaURL + path
	req, err := http.NewRequestWithContext(ctx, method, reqURL, body)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}

	// Apply default headers first, then request-specific headers
	for k, v := range te.defaultHeaders {
		req.Header.Set(k, v)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := te.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("datasource returned status %d: %s", resp.StatusCode, truncateString(string(respBody), 500))
	}

	// Truncate very large responses to stay within token limits
	result := string(respBody)
	return truncateString(result, 50000), nil
}

// resolveTime converts relative time strings like "now-1h" to Unix timestamps.
func resolveTime(s string, now time.Time) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "now") {
		return s
	}

	t := now
	rest := strings.TrimPrefix(s, "now")
	if rest == "" {
		return fmt.Sprintf("%d", t.Unix())
	}

	if d, err := time.ParseDuration(strings.TrimPrefix(rest, "-")); err == nil {
		if strings.HasPrefix(rest, "-") {
			t = t.Add(-d)
		} else {
			t = t.Add(d)
		}
	}

	return fmt.Sprintf("%d", t.Unix())
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "... [truncated]"
}
