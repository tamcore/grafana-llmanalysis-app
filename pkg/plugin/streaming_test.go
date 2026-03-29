package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestStreamingChat_SendsSSEChunks(t *testing.T) {
	t.Parallel()

	requestCount := 0
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		var reqBody map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &reqBody)
		requestCount++

		isStream, _ := reqBody["stream"].(bool)

		if !isStream {
			// Non-streaming: tool-check round — respond with content (no tool_calls)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"choices": []map[string]interface{}{
					{
						"index": 0,
						"message": map[string]interface{}{
							"role":    "assistant",
							"content": "Hello world!",
						},
						"finish_reason": "stop",
					},
				},
				"usage": map[string]interface{}{
					"prompt_tokens":     5,
					"completion_tokens": 3,
				},
			})
			return
		}

		// Streaming: final response
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected http.Flusher")
		}

		chunks := []string{
			`data: {"choices":[{"delta":{"content":"Hello"}}]}`,
			`data: {"choices":[{"delta":{"content":" world"}}]}`,
			`data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}`,
			`data: [DONE]`,
		}

		for _, chunk := range chunks {
			_, _ = w.Write([]byte(chunk + "\n\n"))
			flusher.Flush()
		}
	}))
	defer llmServer.Close()

	app := newTestApp(t, llmServer.URL+"/v1", "key")

	chatReq := `{
		"mode": "explain_panel",
		"prompt": "test",
		"context": {"panel": {"title": "Test"}}
	}`

	req := &backend.CallResourceRequest{
		Path:   "chat/stream",
		Method: http.MethodPost,
		Body:   []byte(chatReq),
	}

	var responses []*backend.CallResourceResponse

	sender := backend.CallResourceResponseSenderFunc(func(res *backend.CallResourceResponse) error {
		cp := &backend.CallResourceResponse{
			Status:  res.Status,
			Headers: res.Headers,
			Body:    make([]byte, len(res.Body)),
		}
		copy(cp.Body, res.Body)
		responses = append(responses, cp)
		return nil
	})

	err := app.CallResource(context.Background(), req, sender)
	if err != nil {
		t.Fatalf("CallResource returned error: %v", err)
	}

	if len(responses) == 0 {
		t.Fatal("expected at least one response")
	}

	// Collect all content from streamed responses
	var fullContent strings.Builder
	for _, resp := range responses {
		var chunk ChatResponse
		if err := json.Unmarshal(resp.Body, &chunk); err != nil {
			continue
		}
		fullContent.WriteString(chunk.Content)
	}

	if got := fullContent.String(); got != "Hello world!" {
		t.Errorf("streamed content = %q, want %q", got, "Hello world!")
	}
}

func TestStreamingChat_MissingPrompt(t *testing.T) {
	t.Parallel()

	app := newTestApp(t, "http://localhost:1/v1", "key")

	req := &backend.CallResourceRequest{
		Path:   "chat/stream",
		Method: http.MethodPost,
		Body:   []byte(`{"mode":"explain_panel","context":{}}`),
	}

	var statusCode int

	sender := backend.CallResourceResponseSenderFunc(func(res *backend.CallResourceResponse) error {
		statusCode = res.Status
		return nil
	})

	err := app.CallResource(context.Background(), req, sender)
	if err != nil {
		t.Fatalf("CallResource returned error: %v", err)
	}

	if statusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", statusCode, http.StatusBadRequest)
	}
}

func TestStreamingChat_ToolCalling(t *testing.T) {
	t.Parallel()

	callCount := 0
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		var reqBody map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &reqBody)
		callCount++

		isStream, _ := reqBody["stream"].(bool)

		if isStream {
			// Streaming response
			w.Header().Set("Content-Type", "text/event-stream")
			flusher := w.(http.Flusher)
			_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"content":"CPU is at 45%"}}]}` + "\n\n"))
			flusher.Flush()
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
			flusher.Flush()
			return
		}

		// Check if messages contain tool results
		messages, _ := reqBody["messages"].([]interface{})
		hasToolResult := false
		for _, m := range messages {
			msg, _ := m.(map[string]interface{})
			if msg["role"] == "tool" {
				hasToolResult = true
			}
		}

		w.Header().Set("Content-Type", "application/json")

		if !hasToolResult {
			// First call: request a tool call
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"choices": []map[string]interface{}{
					{
						"index": 0,
						"message": map[string]interface{}{
							"role":    "assistant",
							"content": "",
							"tool_calls": []map[string]interface{}{
								{
									"id":   "call_123",
									"type": "function",
									"function": map[string]interface{}{
										"name":      "query_prometheus",
										"arguments": `{"query":"up"}`,
									},
								},
							},
						},
						"finish_reason": "tool_calls",
					},
				},
			})
		} else {
			// Second call: return content after tool results
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"choices": []map[string]interface{}{
					{
						"index": 0,
						"message": map[string]interface{}{
							"role":    "assistant",
							"content": "CPU is at 45%",
						},
						"finish_reason": "stop",
					},
				},
			})
		}
	}))
	defer llmServer.Close()

	// Grafana mock for datasource proxy
	grafanaMock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/datasources":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"name": "Prometheus", "type": "prometheus", "uid": "prom-uid"},
			})
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"instance":"node1"},"value":[1234,"0.45"]}]}}`))
		}
	}))
	defer grafanaMock.Close()

	app := newTestApp(t, llmServer.URL+"/v1", "key")
	app.toolExecutor = NewToolExecutor(grafanaMock.URL, log.DefaultLogger)

	chatReq := `{
		"mode": "explain_panel",
		"prompt": "What is the current CPU?",
		"context": {}
	}`

	req := &backend.CallResourceRequest{
		Path:   "chat/stream",
		Method: http.MethodPost,
		Body:   []byte(chatReq),
	}

	var responses []*backend.CallResourceResponse

	sender := backend.CallResourceResponseSenderFunc(func(res *backend.CallResourceResponse) error {
		cp := &backend.CallResourceResponse{
			Status:  res.Status,
			Headers: res.Headers,
			Body:    make([]byte, len(res.Body)),
		}
		copy(cp.Body, res.Body)
		responses = append(responses, cp)
		return nil
	})

	err := app.CallResource(context.Background(), req, sender)
	if err != nil {
		t.Fatalf("CallResource returned error: %v", err)
	}

	if len(responses) == 0 {
		t.Fatal("expected responses")
	}

	// Should have a tool call notification and content chunks
	var gotToolCall bool
	var fullContent strings.Builder
	for _, resp := range responses {
		var chunk ChatResponse
		if err := json.Unmarshal(resp.Body, &chunk); err != nil {
			continue
		}
		if chunk.ToolCall != nil {
			gotToolCall = true
			if chunk.ToolCall.Name != "query_prometheus" {
				t.Errorf("tool name = %q, want query_prometheus", chunk.ToolCall.Name)
			}
		}
		fullContent.WriteString(chunk.Content)
	}

	if !gotToolCall {
		t.Error("expected tool call notification in stream")
	}

	if got := fullContent.String(); got != "CPU is at 45%" {
		t.Errorf("content = %q, want %q", got, "CPU is at 45%")
	}
}
