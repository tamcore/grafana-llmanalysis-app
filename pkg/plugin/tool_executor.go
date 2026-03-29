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

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// ToolExecutor executes tool calls by querying Grafana datasources.
type ToolExecutor struct {
	grafanaURL     string
	httpClient     *http.Client
	defaultHeaders map[string]string
	logger         log.Logger
}

// NewToolExecutor creates a new tool executor.
// grafanaURL is the internal Grafana URL (e.g. http://localhost:3000).
// authHeaders are forwarded to authenticate datasource proxy requests.
func NewToolExecutor(grafanaURL string, logger log.Logger) *ToolExecutor {
	return &ToolExecutor{
		grafanaURL: strings.TrimSuffix(grafanaURL, "/"),
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
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
	case "list_dashboards":
		return te.listDashboards(ctx, arguments, headers)
	case "get_dashboard":
		return te.getDashboard(ctx, arguments, headers)
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

func (te *ToolExecutor) listDashboards(ctx context.Context, arguments string, headers map[string]string) (string, error) {
	var args ListDashboardsArgs
	if arguments != "" && arguments != "{}" {
		if err := json.Unmarshal([]byte(arguments), &args); err != nil {
			return "", fmt.Errorf("parse list_dashboards args: %w", err)
		}
	}

	apiPath := "/api/search?type=dash-db&limit=100"
	if args.Query != "" {
		apiPath += "&query=" + url.QueryEscape(args.Query)
	}

	body, err := te.doGrafanaRequest(ctx, http.MethodGet, apiPath, nil, headers)
	if err != nil {
		return "", err
	}

	var dashboards []struct {
		Title string   `json:"title"`
		UID   string   `json:"uid"`
		Tags  []string `json:"tags"`
		URL   string   `json:"url"`
	}
	if err := json.Unmarshal([]byte(body), &dashboards); err != nil {
		return body, nil //nolint:nilerr // Return raw body if parsing fails
	}

	type dashSummary struct {
		Title string   `json:"title"`
		UID   string   `json:"uid"`
		Tags  []string `json:"tags,omitempty"`
	}
	summaries := make([]dashSummary, len(dashboards))
	for i, d := range dashboards {
		summaries[i] = dashSummary{Title: d.Title, UID: d.UID, Tags: d.Tags}
	}

	out, _ := json.Marshal(summaries)
	return string(out), nil
}

func (te *ToolExecutor) getDashboard(ctx context.Context, arguments string, headers map[string]string) (string, error) {
	var args GetDashboardArgs
	if err := json.Unmarshal([]byte(arguments), &args); err != nil {
		return "", fmt.Errorf("parse get_dashboard args: %w", err)
	}
	if args.UID == "" {
		return "", fmt.Errorf("uid is required")
	}

	apiPath := "/api/dashboards/uid/" + url.PathEscape(args.UID)
	body, err := te.doGrafanaRequest(ctx, http.MethodGet, apiPath, nil, headers)
	if err != nil {
		return "", err
	}

	// Extract a compact summary: title, panels with queries
	var raw struct {
		Dashboard json.RawMessage `json:"dashboard"`
	}
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return truncateString(body, 50000), nil
	}

	var dash struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
		Panels      []struct {
			Title   string `json:"title"`
			Type    string `json:"type"`
			Targets []struct {
				Expr  string `json:"expr"`
				Query string `json:"query"`
				RefID string `json:"refId"`
			} `json:"targets"`
			Panels []struct {
				Title   string `json:"title"`
				Type    string `json:"type"`
				Targets []struct {
					Expr  string `json:"expr"`
					Query string `json:"query"`
					RefID string `json:"refId"`
				} `json:"targets"`
			} `json:"panels"`
		} `json:"panels"`
		Templating struct {
			List []struct {
				Name    string `json:"name"`
				Current struct {
					Text  string `json:"text"`
					Value string `json:"value"`
				} `json:"current"`
			} `json:"list"`
		} `json:"templating"`
	}
	if err := json.Unmarshal(raw.Dashboard, &dash); err != nil {
		return truncateString(body, 50000), nil
	}

	type panelSummary struct {
		Title   string   `json:"title"`
		Type    string   `json:"type"`
		Queries []string `json:"queries,omitempty"`
	}
	var panels []panelSummary
	for _, p := range dash.Panels {
		ps := panelSummary{Title: p.Title, Type: p.Type}
		for _, t := range p.Targets {
			q := t.Expr
			if q == "" {
				q = t.Query
			}
			if q != "" {
				ps.Queries = append(ps.Queries, q)
			}
		}
		if len(ps.Queries) > 0 || ps.Title != "" {
			panels = append(panels, ps)
		}
		// Nested panels (rows)
		for _, np := range p.Panels {
			nps := panelSummary{Title: np.Title, Type: np.Type}
			for _, t := range np.Targets {
				q := t.Expr
				if q == "" {
					q = t.Query
				}
				if q != "" {
					nps.Queries = append(nps.Queries, q)
				}
			}
			if len(nps.Queries) > 0 || nps.Title != "" {
				panels = append(panels, nps)
			}
		}
	}

	type variable struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	var vars []variable
	for _, v := range dash.Templating.List {
		val := v.Current.Value
		if val == "" {
			val = v.Current.Text
		}
		vars = append(vars, variable{Name: v.Name, Value: val})
	}

	summary := struct {
		Title       string         `json:"title"`
		Description string         `json:"description,omitempty"`
		Tags        []string       `json:"tags,omitempty"`
		Variables   []variable     `json:"variables,omitempty"`
		Panels      []panelSummary `json:"panels"`
	}{
		Title:       dash.Title,
		Description: dash.Description,
		Tags:        dash.Tags,
		Variables:   vars,
		Panels:      panels,
	}

	out, _ := json.Marshal(summary)
	return truncateString(string(out), 50000), nil
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

	// Apply default headers first, then request-specific headers (which override)
	for k, v := range te.defaultHeaders {
		req.Header.Set(k, v)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "application/json")

	te.logger.Debug("Tool executor request", "method", method, "path", path,
		"hasDefaultAuth", te.defaultHeaders["Authorization"] != "",
		"hasHeaderAuth", headers["Authorization"] != "")

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
		te.logger.Error("Datasource request failed", "status", resp.StatusCode, "path", path, "body", truncateString(string(respBody), 200))
		return "", fmt.Errorf("datasource returned status %d: %s", resp.StatusCode, truncateString(string(respBody), 500))
	}

	te.logger.Debug("Tool executor response", "status", resp.StatusCode, "bodyLen", len(respBody))
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
