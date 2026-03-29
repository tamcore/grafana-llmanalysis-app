package plugin

import openai "github.com/sashabaranov/go-openai"

// estimateTokens returns an approximate token count for a string.
// Uses the common heuristic of ~4 characters per token which is a reasonable
// approximation for most LLM tokenizers.
func estimateTokens(s string) int {
	if len(s) == 0 {
		return 0
	}
	return (len(s) + 3) / 4
}

// estimateMessagesTokens returns the approximate total token count for a
// slice of OpenAI chat messages, including per-message overhead.
func estimateMessagesTokens(messages []openai.ChatCompletionMessage) int {
	// Per-message overhead: role token + framing (~4 tokens per message).
	const perMessage = 4
	total := 0
	for _, m := range messages {
		total += perMessage + estimateTokens(m.Content)
		// Tool call arguments also consume tokens.
		for _, tc := range m.ToolCalls {
			total += estimateTokens(tc.Function.Name) + estimateTokens(tc.Function.Arguments)
		}
	}
	return total
}
