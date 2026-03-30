package plugin

import (
	"fmt"
	"net/url"
	"strings"
	"unicode"
)

const (
	maxPromptLength = 10000
	maxContextBytes = 512 * 1024 // 512 KB
)

// sanitizePrompt removes control characters and truncates to the maximum length.
func sanitizePrompt(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	for _, r := range s {
		if r == '\n' || r == '\r' || r == '\t' || !unicode.IsControl(r) {
			b.WriteRune(r)
		}
	}

	result := b.String()
	// Truncate at a rune boundary to avoid splitting multi-byte UTF-8
	runes := []rune(result)
	if len(runes) > maxPromptLength {
		result = string(runes[:maxPromptLength])
	}

	return result
}

// sanitizeContextSize rejects context payloads that exceed the maximum size.
func sanitizeContextSize(data []byte, maxBytes int) error {
	if len(data) > maxBytes {
		return fmt.Errorf("context too large: %d bytes exceeds maximum %d bytes", len(data), maxBytes)
	}
	return nil
}

// validateURL checks that a URL uses an allowed scheme (http/https) and has a host.
func validateURL(rawURL string) error {
	if rawURL == "" {
		return fmt.Errorf("URL is empty")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("URL scheme %q not allowed, must be http or https", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("URL has no host")
	}
	return nil
}
