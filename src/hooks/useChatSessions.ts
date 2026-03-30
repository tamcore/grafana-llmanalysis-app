import { useState, useEffect, useCallback, useRef } from 'react';
import { usePluginUserStorage } from '@grafana/runtime';
import {
  ChatSession,
  ChatSessionSummary,
  StorageBackend,
  loadSessionIndex,
  loadSession as loadSessionFromStorage,
  saveSession as saveSessionToStorage,
  deleteSession as deleteSessionFromStorage,
  exportSession as exportSessionFromStorage,
  importSession as importSessionToStorage,
} from '../utils/chatStorage';

export interface UseChatSessionsResult {
  /** List of session summaries, sorted by most recent first. */
  sessions: ChatSessionSummary[];
  /** Whether the initial index load is in progress. */
  loading: boolean;
  /** Load a full session by ID. */
  loadSession: (id: string) => Promise<ChatSession | null>;
  /** Save (create or update) a session. Returns updated index. */
  saveSession: (session: ChatSession) => Promise<ChatSessionSummary[]>;
  /** Delete a session by ID. Returns updated index. */
  deleteSession: (id: string) => Promise<ChatSessionSummary[]>;
  /** Export a session as JSON string. */
  exportSession: (id: string) => Promise<string | null>;
  /** Import a session from JSON string. Returns updated index. */
  importSession: (json: string) => Promise<ChatSessionSummary[]>;
}

export function useChatSessions(): UseChatSessionsResult {
  const pluginStorage = usePluginUserStorage();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Keep a stable ref to avoid re-creating callbacks when pluginStorage changes identity
  const storageRef = useRef<StorageBackend>(pluginStorage);
  storageRef.current = pluginStorage;

  useEffect(() => {
    let cancelled = false;
    loadSessionIndex(storageRef.current)
      .then((index) => {
        if (!cancelled) {
          setSessions(index);
        }
      })
      .catch(() => {
        // Storage unavailable — start with empty index
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (id: string) => {
    return loadSessionFromStorage(storageRef.current, id);
  }, []);

  const save = useCallback(async (session: ChatSession) => {
    const updated = await saveSessionToStorage(storageRef.current, session);
    setSessions(updated);
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    const updated = await deleteSessionFromStorage(storageRef.current, id);
    setSessions(updated);
    return updated;
  }, []);

  const doExport = useCallback(async (id: string) => {
    return exportSessionFromStorage(storageRef.current, id);
  }, []);

  const doImport = useCallback(async (json: string) => {
    const updated = await importSessionToStorage(storageRef.current, json);
    setSessions(updated);
    return updated;
  }, []);

  return {
    sessions,
    loading,
    loadSession: load,
    saveSession: save,
    deleteSession: remove,
    exportSession: doExport,
    importSession: doImport,
  };
}
