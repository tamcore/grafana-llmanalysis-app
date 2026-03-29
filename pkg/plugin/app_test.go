package plugin

import (
	"context"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestNewApp_ReturnsNonNil(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"test-model","timeoutSeconds":30,"maxTokens":1024}`),
	}

	app, err := NewApp(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewApp() returned error: %v", err)
	}

	if app == nil {
		t.Fatal("NewApp() returned nil")
	}
}

func TestNewApp_ParsesSettings(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"gpt-oss120b","timeoutSeconds":60,"maxTokens":4096}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey": "test-api-key",
		},
	}

	inst, err := NewApp(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewApp() returned error: %v", err)
	}

	app, ok := inst.(*App)
	if !ok {
		t.Fatal("NewApp() did not return *App")
	}

	if app.settings.EndpointURL != "https://example.com/v1" {
		t.Errorf("EndpointURL = %q, want %q", app.settings.EndpointURL, "https://example.com/v1")
	}

	if app.settings.Model != "gpt-oss120b" {
		t.Errorf("Model = %q, want %q", app.settings.Model, "gpt-oss120b")
	}

	if app.settings.TimeoutSeconds != 60 {
		t.Errorf("TimeoutSeconds = %d, want %d", app.settings.TimeoutSeconds, 60)
	}

	if app.settings.MaxTokens != 4096 {
		t.Errorf("MaxTokens = %d, want %d", app.settings.MaxTokens, 4096)
	}

	if app.settings.APIKey != "test-api-key" {
		t.Errorf("APIKey = %q, want %q", app.settings.APIKey, "test-api-key")
	}
}

func TestNewApp_DefaultTimeoutSeconds(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"test"}`),
	}

	inst, err := NewApp(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewApp() returned error: %v", err)
	}

	app := inst.(*App)
	if app.settings.TimeoutSeconds != 60 {
		t.Errorf("TimeoutSeconds = %d, want default %d", app.settings.TimeoutSeconds, 60)
	}
}

func TestNewApp_DefaultMaxTokens(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"test"}`),
	}

	inst, err := NewApp(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewApp() returned error: %v", err)
	}

	app := inst.(*App)
	if app.settings.MaxTokens != 4096 {
		t.Errorf("MaxTokens = %d, want default %d", app.settings.MaxTokens, 4096)
	}
}

func TestNewApp_InvalidJSON(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{invalid json}`),
	}

	_, err := NewApp(context.Background(), settings)
	if err == nil {
		t.Fatal("NewApp() expected error for invalid JSON, got nil")
	}
}
