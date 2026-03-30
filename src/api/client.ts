import { getBackendSrv } from '@grafana/runtime';
import { ChatRequest, ChatResponse, AnalysisContext, AnalysisMode } from '../context';
import { PLUGIN_ID } from '../constants';

const RESOURCE_BASE = `/api/plugins/${PLUGIN_ID}/resources`;

export interface ChatHistory {
  role: string;
  content: string;
}

export async function sendChat(
  mode: AnalysisMode,
  prompt: string,
  context: AnalysisContext,
  messages?: ChatHistory[]
): Promise<ChatResponse> {
  const request: ChatRequest = { mode, prompt, context, messages };
  return getBackendSrv().post(`${RESOURCE_BASE}/chat`, request);
}

export async function testConnection(): Promise<{ status: string; message: string }> {
  return getBackendSrv().get(`${RESOURCE_BASE}/health`);
}

export async function* streamChat(
  mode: AnalysisMode,
  prompt: string,
  context: AnalysisContext,
  messages?: ChatHistory[],
  signal?: AbortSignal
): AsyncGenerator<ChatResponse> {
  const request: ChatRequest = { mode, prompt, context, messages };

  const response = await fetch(`${RESOURCE_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const chunk: ChatResponse = JSON.parse(trimmed);
        yield chunk;
        if (chunk.done) {
          return;
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }
}
