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
	defaultTimeoutSeconds = 60
	defaultMaxTokens      = 4096
)

// Settings holds the plugin configuration parsed from Grafana's jsonData and secureJsonData.
type Settings struct {
	EndpointURL    string            `json:"endpointURL"`
	Model          string            `json:"model"`
	TimeoutSeconds int               `json:"timeoutSeconds"`
	MaxTokens      int               `json:"maxTokens"`
	CustomHeaders  map[string]string `json:"customHeaders,omitempty"`
	GrafanaURL     string            `json:"grafanaURL,omitempty"`
	APIKey         string            `json:"-"`
	GrafanaToken   string            `json:"-"`
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

	if apiKey, ok := appSettings.DecryptedSecureJSONData["apiKey"]; ok {
		settings.APIKey = apiKey
	}

	if grafanaToken, ok := appSettings.DecryptedSecureJSONData["grafanaToken"]; ok {
		settings.GrafanaToken = grafanaToken
	}

	grafanaURL := settings.GrafanaURL
	if grafanaURL == "" {
		grafanaURL = "http://localhost:3000"
	}

	te := NewToolExecutor(grafanaURL, logger)
	if settings.GrafanaToken != "" {
		te.defaultHeaders = map[string]string{
			"Authorization": "Bearer " + settings.GrafanaToken,
		}
		logger.Info("Tool executor configured with service account token")
	} else {
		logger.Warn("No Grafana service account token configured; tool calls will rely on forwarded request headers")
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
