// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveConnection } from "../../desktop/app/connection.js";

const storageKey = "fable.control-plane.connection";

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: memoryStorage(),
  });
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"];
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("desktop control-plane credentials", () => {
  it("does not persist the ephemeral bearer token in a Tauri renderer", () => {
    (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] = {};

    saveConnection({ url: "http://127.0.0.1:1234", token: "secret-token" });

    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("allows an explicit browser-build connection to persist locally", () => {
    saveConnection({ url: "http://127.0.0.1:1234", token: "developer-token" });

    expect(window.localStorage.getItem(storageKey)).toContain("developer-token");
  });

  it("rejects bearer tokens over non-loopback plaintext transport", () => {
    expect(() =>
      saveConnection({ url: "http://remote.example.test:3210", token: "exposed-token" }),
    ).toThrow(/HTTPS|loopback/);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });
});
