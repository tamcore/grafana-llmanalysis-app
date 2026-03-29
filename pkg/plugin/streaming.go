package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	openai "github.com/sashabaranov/go-openai"
)

const maxToolRounds = 25

// streamChatCompletion sends a streaming chat completion request with tool-calling
// support and relays chunks via the sender.
func (a *App) streamChatCompletion(ctx context.Context, req ChatRequest, sender backend.CallResourceResponseSender, authHeaders map[string]string) error {
	systemPrompt := buildSystemPrompt(req.Mode, req.Context)

	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
		{Role: openai.ChatMessageRoleUser, Content: req.Prompt},
	}

	config := openai.DefaultConfig(a.settings.APIKey)
	config.BaseURL = strings.TrimSuffix(a.settings.EndpointURL, "/")
	client := openai.NewClientWithConfig(config)
	tools := llmTools()

	for round := 0; round < maxToolRounds; round++ {
		ccReq := openai.ChatCompletionRequest{
			Model:     a.settings.Model,
			Messages:  messages,
			MaxTokens: a.settings.MaxTokens,
			Tools:     tools,
		}

		// First, make a non-streaming request to check if we get tool_calls
		resp, err := client.CreateChatCompletion(ctx, ccReq)
		if err != nil {
			return fmt.Errorf("chat completion (round %d): %w", round, err)
		}

		if len(resp.Choices) == 0 {
			return fmt.Errorf("no choices in response (round %d)", round)
		}

		choice := resp.Choices[0]

		// If the model wants to call tools, execute them and loop
		if choice.FinishReason == openai.FinishReasonToolCalls && len(choice.Message.ToolCalls) > 0 {
			// Add assistant's tool_calls message to history
			messages = append(messages, choice.Message)

			for _, tc := range choice.Message.ToolCalls {
				// Notify the frontend about the tool call
				if err := sendStreamChunk(sender, ChatResponse{
					Content:  "",
					ToolCall: &ToolCallInfo{Name: tc.Function.Name, Arguments: tc.Function.Arguments},
				}); err != nil {
					return err
				}

				result, execErr := a.toolExecutor.Execute(ctx, tc.Function.Name, tc.Function.Arguments, authHeaders)
				if execErr != nil {
					result = fmt.Sprintf("Error: %s", execErr.Error())
				}

				// Add tool result to message history
				messages = append(messages, openai.ChatCompletionMessage{
					Role:       openai.ChatMessageRoleTool,
					Content:    result,
					ToolCallID: tc.ID,
				})
			}

			continue // Next round with tool results
		}

		// Model returned content — stream it to the frontend
		return a.streamFinalResponse(ctx, client, messages, tools, sender)
	}

	// Tool-calling limit reached — ask the LLM to produce a final answer
	// without tools so the user always gets a response.
	a.logger.Warn("Tool-calling round limit reached, requesting final summary", "maxRounds", maxToolRounds)
	messages = append(messages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleSystem,
		Content: "You have reached the maximum number of tool calls. Please provide your best answer now based on the data you have already collected. Do not attempt any more tool calls.",
	})
	return a.streamFinalResponse(ctx, client, messages, nil, sender)
}

// streamFinalResponse re-issues the request as a stream to get the final content response.
func (a *App) streamFinalResponse(ctx context.Context, client *openai.Client, messages []openai.ChatCompletionMessage, tools []openai.Tool, sender backend.CallResourceResponseSender) error {
	stream, err := client.CreateChatCompletionStream(ctx, openai.ChatCompletionRequest{
		Model:     a.settings.Model,
		Messages:  messages,
		MaxTokens: a.settings.MaxTokens,
		Tools:     tools,
		Stream:    true,
	})
	if err != nil {
		return fmt.Errorf("create stream: %w", err)
	}
	defer func() { _ = stream.Close() }()

	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return sendStreamChunk(sender, ChatResponse{Content: "", Done: true})
		}
		if err != nil {
			// Stream error after partial content — still send done so
			// the frontend commits whatever it received.
			a.logger.Error("Stream recv error, sending done", "error", err)
			_ = sendStreamChunk(sender, ChatResponse{Content: "", Done: true})
			return nil
		}

		if len(response.Choices) > 0 {
			chunk := ChatResponse{
				Content: response.Choices[0].Delta.Content,
			}
			if err := sendStreamChunk(sender, chunk); err != nil {
				return err
			}
		}
	}
}

func sendStreamChunk(sender backend.CallResourceResponseSender, chunk ChatResponse) error {
	body, err := json.Marshal(chunk)
	if err != nil {
		return fmt.Errorf("marshal chunk: %w", err)
	}
	body = append(body, '\n')

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusOK,
		Headers: map[string][]string{
			"Content-Type": {"application/x-ndjson"},
		},
		Body: body,
	})
}
