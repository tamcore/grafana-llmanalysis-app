package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"time"
)

func TestToolExecutor_ListDatasources(t *testing.T) {
	t.Parallel()

	grafanaMock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/datasources" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]interface{}{
			{"name": "Prometheus", "type": "prometheus", "uid": "prom-uid", "url": "http://prom:9090"},
			{"name": "Loki", "type": "loki", "uid": "loki-uid", "url": "http://loki:3100"},
		})
	}))
	defer grafanaMock.Close()

	te := NewToolExecutor(grafanaMock.URL, log.DefaultLogger)
	result, err := te.Execute(context.Background(), "list_datasources", "{}", nil)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	var datasources []struct {
		Name string `json:"name"`
		Type string `json:"type"`
		UID  string `json:"uid"`
	}
	if err := json.Unmarshal([]byte(result), &datasources); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	if len(datasources) != 2 {
		t.Fatalf("expected 2 datasources, got %d", len(datasources))
	}

	if datasources[0].Name != "Prometheus" || datasources[0].UID != "prom-uid" {
		t.Errorf("unexpected first datasource: %+v", datasources[0])
	}
}

func TestToolExecutor_QueryPrometheus(t *testing.T) {
	t.Parallel()

	grafanaMock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/datasources":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"name": "Prometheus", "type": "prometheus", "uid": "prom-uid"},
			})
		default:
			// Datasource proxy query
			query := r.URL.Query().Get("query")
			if query == "" {
				t.Error("expected query parameter")
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"resultType": "matrix",
					"result": []map[string]interface{}{
						{
							"metric": map[string]string{"instance": "node1"},
							"values": [][]interface{}{{float64(time.Now().Unix()), "0.45"}},
						},
					},
				},
			})
		}
	}))
	defer grafanaMock.Close()

	te := NewToolExecutor(grafanaMock.URL, log.DefaultLogger)
	args := `{"query":"rate(node_cpu_seconds_total[5m])","step":"60s"}`
	result, err := te.Execute(context.Background(), "query_prometheus", args, nil)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	if result == "" {
		t.Error("expected non-empty result")
	}

	// Verify it contains metric data
	var promResp map[string]interface{}
	if err := json.Unmarshal([]byte(result), &promResp); err != nil {
		t.Fatalf("parse result: %v", err)
	}

	if promResp["status"] != "success" {
		t.Errorf("expected success status, got %v", promResp["status"])
	}
}

func TestToolExecutor_UnknownTool(t *testing.T) {
	t.Parallel()

	te := NewToolExecutor("http://localhost:1", log.DefaultLogger)
	_, err := te.Execute(context.Background(), "unknown_tool", "{}", nil)
	if err == nil {
		t.Fatal("expected error for unknown tool")
	}
}

func TestToolExecutor_NoDatasource(t *testing.T) {
	t.Parallel()

	grafanaMock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer grafanaMock.Close()

	te := NewToolExecutor(grafanaMock.URL, log.DefaultLogger)
	_, err := te.Execute(context.Background(), "query_prometheus", `{"query":"up"}`, nil)
	if err == nil {
		t.Fatal("expected error when no datasource found")
	}
}

func TestResolveTime(t *testing.T) {
	t.Parallel()

	now := time.Unix(1700000000, 0) // Fixed Unix timestamp

	tests := []struct {
		input    string
		expected string
	}{
		{"now", "1700000000"},
		{"now-1h", "1699996400"},
		{"now-5m", "1699999700"},
		{"1700000000", "1700000000"},
	}

	for _, tt := range tests {
		got := resolveTime(tt.input, now)
		if got != tt.expected {
			t.Errorf("resolveTime(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestTruncateString(t *testing.T) {
	t.Parallel()

	short := "hello"
	if got := truncateString(short, 10); got != short {
		t.Errorf("expected %q, got %q", short, got)
	}

	long := "hello world this is a long string"
	got := truncateString(long, 10)
	if len(got) > 30 {
		t.Errorf("expected truncated string, got length %d", len(got))
	}
	if got != "hello worl... [truncated]" {
		t.Errorf("got %q", got)
	}
}
