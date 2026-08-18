import { useCallback, useEffect, useMemo, useState } from "react";
import { FableClient } from "./client.js";
import { connectControlPlanes } from "./connection.js";
import { notifyForEvent } from "./notifications.js";
import type { ControlPlaneConnection, RuntimeSnapshot, Snapshot } from "./types.js";

const emptySnapshot: Snapshot = {
  providers: [],
  runs: [],
  workflows: [],
  approvals: [],
  waits: [],
  scheduler: { running: false, activeRuns: 0, maxConcurrentRuns: 0 },
};

export interface FableData {
  connection?: ControlPlaneConnection;
  connections: ControlPlaneConnection[];
  client?: FableClient;
  clients: ReadonlyMap<string, FableClient>;
  runtimes: RuntimeSnapshot[];
  snapshot: Snapshot;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  reconnect: () => void;
}

export function useFable(): FableData {
  const [connections, setConnections] = useState<ControlPlaneConnection[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeSnapshot[]>([]);
  const [connectionError, setConnectionError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const clients = useMemo(
    () => new Map(connections.map((connection) => [connection.id, new FableClient(connection)])),
    [connections],
  );

  const refresh = useCallback(async () => {
    if (connections.length === 0) return;
    await Promise.all(
      connections.map(async (connection) => {
        const client = clients.get(connection.id)!;
        try {
          const snapshot = scopeSnapshot(await client.snapshot(), connection);
          setRuntimes((current) =>
            upsertRuntime(current, { connection, snapshot, loading: false }),
          );
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          setRuntimes((current) =>
            upsertRuntime(current, {
              connection,
              snapshot:
                current.find((runtime) => runtime.connection.id === connection.id)?.snapshot ??
                emptySnapshot,
              loading: false,
              error,
            }),
          );
        }
      }),
    );
  }, [clients, connections]);

  useEffect(() => {
    let current = true;
    void connectControlPlanes()
      .then((values) => {
        if (!current) return;
        setConnections(values);
        setRuntimes(
          values.map((connection) => ({ connection, snapshot: emptySnapshot, loading: true })),
        );
        setConnectionError(undefined);
      })
      .catch((cause: unknown) => {
        if (current) setConnectionError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      current = false;
    };
  }, [connectionAttempt]);

  useEffect(() => {
    if (connections.length === 0) return;
    const controllers = connections.map((connection) => {
      const controller = new AbortController();
      void clients
        .get(connection.id)!
        .subscribe((event) => {
          void notifyForEvent(event).catch(() => undefined);
          void refresh();
        }, controller.signal)
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setRuntimes((current) =>
            upsertRuntime(current, {
              connection,
              snapshot:
                current.find((runtime) => runtime.connection.id === connection.id)?.snapshot ??
                emptySnapshot,
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            }),
          );
        });
      return controller;
    });
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => {
      controllers.forEach((controller) => controller.abort());
      window.clearInterval(interval);
    };
  }, [clients, connections, refresh]);

  const snapshot = useMemo(() => aggregateSnapshots(runtimes), [runtimes]);
  const loading =
    runtimes.length === 0
      ? connectionError === undefined
      : runtimes.every(({ loading }) => loading);
  const healthy = runtimes.filter(({ error }) => error === undefined);
  const error =
    connectionError ??
    (runtimes.length > 0 && healthy.length === 0
      ? runtimes
          .map((runtime) => `${runtime.connection.name}: ${runtime.error ?? "unavailable"}`)
          .join("; ")
      : undefined);
  const first = connections[0];
  const primaryClient = first === undefined ? undefined : clients.get(first.id);
  return {
    ...(first === undefined ? {} : { connection: first }),
    ...(primaryClient === undefined ? {} : { client: primaryClient }),
    connections,
    clients,
    runtimes,
    snapshot,
    loading,
    ...(error === undefined ? {} : { error }),
    refresh,
    reconnect: () => setConnectionAttempt((value) => value + 1),
  };
}

export function scopeSnapshot(snapshot: Snapshot, connection: ControlPlaneConnection): Snapshot {
  const scope = { runtimeId: connection.id, runtimeName: connection.name };
  return {
    providers: snapshot.providers.map((value) => ({ ...value, ...scope })),
    runs: snapshot.runs.map((value) => ({
      ...value,
      ...scope,
      executionLocation: connection.location,
    })),
    workflows: snapshot.workflows.map((value) => ({ ...value, ...scope })),
    approvals: snapshot.approvals.map((value) => ({ ...value, ...scope })),
    waits: snapshot.waits.map((value) => ({ ...value, ...scope })),
    scheduler: snapshot.scheduler,
  };
}

function aggregateSnapshots(runtimes: RuntimeSnapshot[]): Snapshot {
  const healthy = runtimes.filter(({ error }) => error === undefined);
  return {
    providers: healthy.flatMap(({ snapshot }) => snapshot.providers),
    runs: healthy
      .flatMap(({ snapshot }) => snapshot.runs)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    workflows: healthy.flatMap(({ snapshot }) => snapshot.workflows),
    approvals: healthy.flatMap(({ snapshot }) => snapshot.approvals),
    waits: healthy.flatMap(({ snapshot }) => snapshot.waits),
    scheduler: {
      running: healthy.some(({ snapshot }) => snapshot.scheduler.running),
      activeRuns: healthy.reduce((sum, { snapshot }) => sum + snapshot.scheduler.activeRuns, 0),
      maxConcurrentRuns: healthy.reduce(
        (sum, { snapshot }) => sum + snapshot.scheduler.maxConcurrentRuns,
        0,
      ),
    },
  };
}

function upsertRuntime(values: RuntimeSnapshot[], value: RuntimeSnapshot): RuntimeSnapshot[] {
  const found = values.some(({ connection }) => connection.id === value.connection.id);
  return found
    ? values.map((current) => (current.connection.id === value.connection.id ? value : current))
    : [...values, value];
}
