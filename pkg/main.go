package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend/app"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/tamcore/grafana-llm/pkg/plugin"
)

func main() {
	if err := app.Manage("tamcore-llmanalysis-app", plugin.NewApp, app.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("Error running plugin", "error", err)
		os.Exit(1)
	}
}
