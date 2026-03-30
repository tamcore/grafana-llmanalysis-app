import { ChatMessage } from '../components/ChatView';

/** Persistent chat session stored via Grafana user storage. */
export interface ChatSession {
  id: string;
  title: string;
  mode: 'chat' | 'dashboard-chat';
  messages: ChatMessage[];
  context: ChatSessionContext;
  contextTokens: number;
  maxTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionContext {
  datasources?: Array<{ name: string; type: string; uid: string }>;
  dashboards?: Array<{ title: string; uid: string }>;
  autoDiscovery?: boolean;
  dashboardUid?: string;
}

/** Lightweight summary for the session list (avoids loading full messages). */
export interface ChatSessionSummary {
  id: string;
  title: string;
  mode: string;
  messageCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

const INDEX_KEY = 'chat-sessions';
const SESSION_KEY_PREFIX = 'chat-session-';
const MAX_SESSIONS = 50;
const PREVIEW_LENGTH = 100;

/** Storage interface matching Grafana's PluginUserStorage. */
export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Generate a unique session ID. */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

/** Derive a session title from the first user message. */
export function generateTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) {
    return 'New Chat';
  }
  const text = firstUser.content.trim();
  if (text.length <= 60) {
    return text;
  }
  return text.slice(0, 57) + '...';
}

/** Build a summary from a full session. */
export function toSummary(session: ChatSession): ChatSessionSummary {
  const firstUser = session.messages.find((m) => m.role === 'user');
  return {
    id: session.id,
    title: session.title,
    mode: session.mode,
    messageCount: session.messages.length,
    preview: firstUser ? firstUser.content.slice(0, PREVIEW_LENGTH) : '',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** Load the session index from storage. */
export async function loadSessionIndex(storage: StorageBackend): Promise<ChatSessionSummary[]> {
  const raw = await storage.getItem(INDEX_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as ChatSessionSummary[];
  } catch {
    return [];
  }
}

/** Load a full session by ID. */
export async function loadSession(storage: StorageBackend, id: string): Promise<ChatSession | null> {
  const raw = await storage.getItem(SESSION_KEY_PREFIX + id);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ChatSession;
  } catch {
    return null;
  }
}

/** Save a session and update the index. Trims to MAX_SESSIONS. */
export async function saveSession(storage: StorageBackend, session: ChatSession): Promise<ChatSessionSummary[]> {
  session.updatedAt = new Date().toISOString();
  await storage.setItem(SESSION_KEY_PREFIX + session.id, JSON.stringify(session));

  const index = await loadSessionIndex(storage);
  const existing = index.findIndex((s) => s.id === session.id);
  const summary = toSummary(session);

  if (existing >= 0) {
    index[existing] = summary;
  } else {
    index.unshift(summary);
  }

  // Sort by updatedAt descending and trim
  index.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const trimmed = index.slice(0, MAX_SESSIONS);

  await storage.setItem(INDEX_KEY, JSON.stringify(trimmed));
  return trimmed;
}

/** Delete a session and update the index. */
export async function deleteSession(storage: StorageBackend, id: string): Promise<ChatSessionSummary[]> {
  await storage.setItem(SESSION_KEY_PREFIX + id, '');
  const index = await loadSessionIndex(storage);
  const filtered = index.filter((s) => s.id !== id);
  await storage.setItem(INDEX_KEY, JSON.stringify(filtered));
  return filtered;
}

/** Export a session as a JSON string for sharing. */
export async function exportSession(storage: StorageBackend, id: string): Promise<string | null> {
  const session = await loadSession(storage, id);
  if (!session) {
    return null;
  }
  return JSON.stringify(session, null, 2);
}

/** Type guard to validate untrusted JSON as a ChatSession. */
function validateChatSession(obj: unknown): obj is ChatSession {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    (o.mode === 'chat' || o.mode === 'dashboard-chat') &&
    Array.isArray(o.messages) &&
    o.messages.every(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as Record<string, unknown>).role === 'string' &&
        typeof (m as Record<string, unknown>).content === 'string'
    )
  );
}

/** Import a session from JSON. Returns the imported session summary list. */
export async function importSession(storage: StorageBackend, json: string): Promise<ChatSessionSummary[]> {
  const parsed: unknown = JSON.parse(json);
  if (!validateChatSession(parsed)) {
    throw new Error('Invalid session format');
  }
  const session: ChatSession = {
    ...parsed,
    id: generateSessionId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveSession(storage, session);
}
