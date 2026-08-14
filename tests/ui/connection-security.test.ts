// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { saveConnection } from "../../desktop/app/connection.js";

const storageKey = "fable.control-plane.connection";

afterEach(() => {
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"];
});

describe("desktop control-plane credentials", () => {
  it("does not persist the ephemeral bearer token in a Tauri renderer", () => {
    (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] = {};

    saveConnection({ url: "http://127.0.0.1:1234", token: "secret-token" });

    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("allows an explicit browser-build connection to persist locally", () => {
    saveConnection({ url: "http://127.0.0.1:1234", token: "developer-token" });

    expect(localStorage.getItem(storageKey)).toContain("developer-token");
  });
});
