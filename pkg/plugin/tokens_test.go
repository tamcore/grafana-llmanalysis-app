package plugin

import (
	"testing"

	openai "github.com/sashabaranov/go-openai"
)

func TestEstimateTokens(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  int
	}{
		{"empty", "", 0},
		{"short", "hi", 1},
		{"four chars", "abcd", 1},
		{"five chars", "abcde", 2},
		{"sentence", "Hello, world! This is a test.", 8},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := estimateTokens(tt.input)
			if got != tt.want {
				t.Errorf("estimateTokens(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestEstimateMessagesTokens(t *testing.T) {
	t.Parallel()

	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: "You are helpful."},
		{Role: openai.ChatMessageRoleUser, Content: "Hello"},
	}

	got := estimateMessagesTokens(messages)
	// "You are helpful." = 16 chars → 4 tokens + 4 overhead = 8
	// "Hello" = 5 chars → 2 tokens + 4 overhead = 6
	// Total = 14
	want := 14
	if got != want {
		t.Errorf("estimateMessagesTokens = %d, want %d", got, want)
	}
}

func TestEstimateMessagesTokens_WithToolCalls(t *testing.T) {
	t.Parallel()

	messages := []openai.ChatCompletionMessage{
		{
			Role:    openai.ChatMessageRoleAssistant,
			Content: "",
			ToolCalls: []openai.ToolCall{
				{
					Function: openai.FunctionCall{
						Name:      "query_prometheus",
						Arguments: `{"query":"up"}`,
					},
				},
			},
		},
	}

	got := estimateMessagesTokens(messages)
	// Content "" = 0 tokens + 4 overhead = 4
	// "query_prometheus" = 16 chars → 4 tokens
	// `{"query":"up"}` = 14 chars → 4 tokens (rounded up)
	// Total = 4 + 4 + 4 = 12
	want := 12
	if got != want {
		t.Errorf("estimateMessagesTokens = %d, want %d", got, want)
	}
}
