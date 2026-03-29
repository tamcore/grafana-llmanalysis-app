package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
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
	APIKey         string            `json:"-"`
}

// App is the main plugin instance.
type App struct {
	backend.CallResourceHandler
	settings Settings
	logger   log.Logger
}

// NewApp creates a new plugin instance from the given settings.
func NewApp(_ context.Context, appSettings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
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

	logger := log.DefaultLogger

	app := &App{
		settings: settings,
		logger:   logger,
	}

	return app, nil
}

// Dispose cleans up resources on plugin shutdown.
func (a *App) Dispose() {}
