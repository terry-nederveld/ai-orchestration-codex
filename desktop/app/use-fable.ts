import { useCallback, useEffect, useMemo, useState } from "react";
import { FableClient } from "./client.js";
import { connectControlPlane } from "./connection.js";
import type { ControlPlaneConnection, Snapshot } from "./types.js";

const emptySnapshot: Snapshot = { providers: [], runs: [], workflows: [], approvals: [] };

export interface FableData {
  connection?: ControlPlaneConnection;
  client?: FableClient;
  snapshot: Snapshot;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  reconnect: () => void;
}

export function useFable(): FableData {
  const [connection, setConnection] = useState<ControlPlaneConnection>();
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const client = useMemo(
    () => (connection === undefined ? undefined : new FableClient(connection)),
    [connection],
  );

  const refresh = useCallback(async () => {
    if (client === undefined) return;
    try {
      setSnapshot(await client.snapshot());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void connectControlPlane()
      .then((value) => {
        if (current) setConnection(value);
      })
      .catch((cause: unknown) => {
        if (current) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [connectionAttempt]);

  useEffect(() => {
    if (client === undefined) return;
    const controller = new AbortController();
    void refresh();
    void client
      .subscribe(() => void refresh(), controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [client, refresh]);

  return {
    ...(connection === undefined ? {} : { connection }),
    ...(client === undefined ? {} : { client }),
    snapshot,
    loading,
    ...(error === undefined ? {} : { error }),
    refresh,
    reconnect: () => setConnectionAttempt((value) => value + 1),
  };
}
