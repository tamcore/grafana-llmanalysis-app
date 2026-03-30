package plugin

import (
	"context"
	"os"
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
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"gpt-4o","timeoutSeconds":60,"maxTokens":4096}`),
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

	if app.settings.Model != "gpt-4o" {
		t.Errorf("Model = %q, want %q", app.settings.Model, "gpt-4o")
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

func TestNewApp_GrafanaTokenPath(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"test","grafanaTokenPath":"/var/run/secrets/grafana-sa/token"}`),
	}

	inst, err := NewApp(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewApp() returned error: %v", err)
	}

	app, ok := inst.(*App)
	if !ok {
		t.Fatal("NewApp() did not return *App")
	}

	if app.settings.GrafanaTokenPath != "/var/run/secrets/grafana-sa/token" {
		t.Errorf("GrafanaTokenPath = %q, want %q", app.settings.GrafanaTokenPath, "/var/run/secrets/grafana-sa/token")
	}

	if app.toolExecutor.tokenPath != "/var/run/secrets/grafana-sa/token" {
		t.Errorf("toolExecutor.tokenPath = %q, want %q", app.toolExecutor.tokenPath, "/var/run/secrets/grafana-sa/token")
	}
}

func TestNewApp_PlaintextTokenIgnored(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"test","grafanaServiceAccountToken":"plaintext-token"}`),
	}

	inst, err := NewApp(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewApp() returned error: %v", err)
	}

	app := inst.(*App)
	// Plaintext token in jsonData must NOT be promoted to GrafanaToken
	if app.settings.GrafanaToken != "" {
		t.Errorf("GrafanaToken = %q, want empty (plaintext token should be ignored)", app.settings.GrafanaToken)
	}
}

func TestNewApp_RejectsFileSchemeEndpointURL(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"file:///etc/passwd","model":"test"}`),
	}

	_, err := NewApp(context.Background(), settings)
	if err == nil {
		t.Fatal("expected error for file:// endpointURL")
	}
}

func TestNewApp_RejectsFileSchemeGrafanaURL(t *testing.T) {
	t.Parallel()

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"test","grafanaURL":"gopher://evil.com"}`),
	}

	_, err := NewApp(context.Background(), settings)
	if err == nil {
		t.Fatal("expected error for gopher:// grafanaURL")
	}
}

func TestNewApp_GrafanaTokenPathTakesPrecedence(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	tokenFile := tmpDir + "/token"
	if err := os.WriteFile(tokenFile, []byte("file-token"), 0o600); err != nil {
		t.Fatal(err)
	}

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"endpointURL":"https://example.com/v1","model":"test","grafanaTokenPath":"` + tokenFile + `"}`),
		DecryptedSecureJSONData: map[string]string{
			"grafanaToken": "static-token",
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

	// tokenPath should be set on executor; static token should NOT be in defaultHeaders
	if app.toolExecutor.tokenPath != tokenFile {
		t.Errorf("tokenPath = %q, want %q", app.toolExecutor.tokenPath, tokenFile)
	}
}
