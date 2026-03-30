package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/prometheus/client_golang/prometheus"
)

const (
	defaultTimeoutSeconds   = 60
	defaultMaxTokens        = 4096
	defaultMaxContextTokens = 120000
)

// Settings holds the plugin configuration parsed from Grafana's jsonData and secureJsonData.
type Settings struct {
	EndpointURL      string            `json:"endpointURL"`
	Model            string            `json:"model"`
	TimeoutSeconds   int               `json:"timeoutSeconds"`
	MaxTokens        int               `json:"maxTokens"`
	MaxContextTokens int               `json:"maxContextTokens"`
	CustomHeaders    map[string]string `json:"customHeaders,omitempty"`
	GrafanaURL       string            `json:"grafanaURL,omitempty"`
	// GrafanaTokenPath is a file path to read the Grafana service account token from.
	// When set, the token is re-read on each request, enabling rotation without restarts.
	GrafanaTokenPath string `json:"grafanaTokenPath,omitempty"`
	// GrafanaServiceAcctToken is read from jsonData for convenience.
	GrafanaServiceAcctToken string `json:"grafanaServiceAccountToken,omitempty"`
	APIKey                  string `json:"-"`
	// GrafanaToken is read from secureJsonData.
	GrafanaToken string `json:"-"`
}

// App is the main plugin instance.
type App struct {
	httpHandler  backend.CallResourceHandler
	settings     Settings
	logger       log.Logger
	metrics      *metrics
	toolExecutor *ToolExecutor
}

// NewApp creates a new plugin instance from the given settings.
func NewApp(_ context.Context, appSettings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	logger := log.DefaultLogger
	logger.Info("Creating new plugin instance", "updated", appSettings.Updated)

	var settings Settings
	if err := json.Unmarshal(appSettings.JSONData, &settings); err != nil {
		return nil, fmt.Errorf("unmarshal settings: %w", err)
	}

	if settings.TimeoutSeconds <= 0 {
		settings.TimeoutSeconds = defaultTimeoutSeconds
	}

	if settings.MaxTokens <= 0 {
		settings.MaxTokens = defaultMaxTokens
	}

	if settings.MaxContextTokens <= 0 {
		settings.MaxContextTokens = defaultMaxContextTokens
	}

	if apiKey, ok := appSettings.DecryptedSecureJSONData["apiKey"]; ok {
		settings.APIKey = apiKey
	}

	if grafanaToken, ok := appSettings.DecryptedSecureJSONData["grafanaToken"]; ok {
		settings.GrafanaToken = grafanaToken
	}
	// Also support token from jsonData for convenience
	if settings.GrafanaToken == "" && settings.GrafanaServiceAcctToken != "" {
		settings.GrafanaToken = settings.GrafanaServiceAcctToken
	}

	grafanaURL := settings.GrafanaURL
	if grafanaURL == "" {
		grafanaURL = "http://localhost:3000"
	}

	te := NewToolExecutor(grafanaURL, logger)
	// Grafana strips auth headers from plugin backend requests, so a service
	// account token is needed for the tool executor to call the Grafana API.
	// When forwarded headers are present they take precedence (future-proofing).
	if settings.GrafanaTokenPath != "" {
		te.tokenPath = settings.GrafanaTokenPath
		logger.Info("Tool executor configured with token file", "path", settings.GrafanaTokenPath)
	} else if settings.GrafanaToken != "" {
		te.defaultHeaders = map[string]string{
			"Authorization": "Bearer " + settings.GrafanaToken,
		}
		logger.Info("Tool executor configured with service account token")
	} else {
		logger.Warn("No Grafana service account token configured; tool calls will fail unless headers are forwarded")
	}

	app := &App{
		settings:     settings,
		logger:       logger,
		metrics:      newMetrics(prometheus.NewRegistry()),
		toolExecutor: te,
	}

	app.registerRoutes()

	return app, nil
}

// Dispose cleans up resources on plugin shutdown.
func (a *App) Dispose() {}
