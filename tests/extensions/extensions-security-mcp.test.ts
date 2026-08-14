import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { FilesystemSkillProvider } from "../../src/adapters/extensions/filesystem-skills.js";
import { ManifestExtensionProvider } from "../../src/adapters/extensions/manifest-extension-provider.js";
import { McpToolProvider } from "../../src/adapters/mcp/mcp-tool-provider.js";
import { CompositeSecretProvider } from "../../src/adapters/security/composite-secrets.js";
import { EncryptedFileSecretProvider } from "../../src/adapters/security/encrypted-file-secrets.js";
import { EnvironmentSecretProvider } from "../../src/adapters/security/environment-secrets.js";
import { InMemorySecretProvider } from "../../src/adapters/security/in-memory-secrets.js";

describe("extension, skill, MCP, and secret boundaries", () => {
  it("discovers manifests before execution and enforces permission grants", async () => {
    const root = await mkdtemp(join(tmpdir(), "fable-extension-"));
    await writeFile(
      join(root, "fable-extension.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "example.readonly",
        name: "Example",
        version: "1.0.0",
        apiVersion: "1",
        entry: "extension.mjs",
        provides: { tools: ["example.echo"] },
        permissions: ["filesystem.read"],
      }),
    );
    await writeFile(
      join(root, "extension.mjs"),
      `export function activate() {
        return { tools: [{
          name: "example.echo",
          description: "Echo input",
          inputSchema: { type: "object" },
          permissions: ["filesystem.read"],
          async execute(input) { return { content: input }; }
        }] };
      }`,
    );
    const denied = new ManifestExtensionProvider();
    const [manifest] = await denied.discover([root]);
    expect(manifest).toMatchObject({ id: "example.readonly", permissions: ["filesystem.read"] });
    if (manifest === undefined) throw new Error("Manifest fixture was not discovered");
    await expect(denied.load(manifest)).rejects.toThrow("lacks grants");

    const allowed = new ManifestExtensionProvider({
      grants: { "example.readonly": ["filesystem.read"] },
    });
    const [allowedManifest] = await allowed.discover([root]);
    if (allowedManifest === undefined) throw new Error("Manifest fixture was not discovered");
    const contribution = await allowed.load(allowedManifest);
    expect(contribution.tools?.map((tool) => tool.name)).toEqual(["example.echo"]);
  });

  it("indexes skills and loads full content only on demand", async () => {
    const root = await mkdtemp(join(tmpdir(), "fable-skill-"));
    await writeFile(
      join(root, "SKILL.md"),
      `---
id: review-security
name: Security Review
description: Review trust boundaries
tags: [security, review]
---

# Instructions

Inspect each external input.
`,
    );
    const provider = new FilesystemSkillProvider();
    const metadata = await provider.discover([root]);

    expect(metadata).toEqual([
      expect.objectContaining({ id: "review-security", name: "Security Review" }),
    ]);
    expect(metadata[0]).not.toHaveProperty("content");
    const loaded = await provider.load("review-security");
    expect(loaded.content.includes("Inspect each external input")).toBe(true);
  });

  it("negotiates an MCP server and exposes namespaced tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "fixture-server", version: "1.0.0" });
    server.registerTool(
      "echo",
      {
        description: "Echo a value",
        inputSchema: z.object({ value: z.string() }),
        annotations: { readOnlyHint: true },
      },
      ({ value }) => ({ content: [{ type: "text", text: value }] }),
    );
    await server.connect(serverTransport);
    const provider = new McpToolProvider({
      id: "fixture",
      transport: "stdio",
      command: "unused",
      permissions: ["filesystem.read"],
      transportFactory: () => clientTransport,
    });
    await provider.connect();

    expect(provider.serverVersion()).toMatchObject({ name: "fixture-server" });
    const tool = provider.get("fixture.echo");
    if (tool === undefined) throw new Error("MCP echo tool was not discovered");
    const result = await tool.execute(
      { value: "hello" },
      {
        runId: "run-1",
        workspacePath: "/workspace",
        signal: new AbortController().signal,
        metadata: {},
      },
    );
    expect(result).toMatchObject({ content: [{ type: "text", text: "hello" }] });
    await provider.close();
    await server.close();
  });

  it("encrypts writable secrets and composes them with environment lookup", async () => {
    const root = await mkdtemp(join(tmpdir(), "fable-secrets-"));
    await chmod(root, 0o700);
    const path = join(root, "vault.json");
    const encrypted = new EncryptedFileSecretProvider(path, "correct horse battery staple");
    await encrypted.set("linear.token", "secret-linear-value");

    expect(await encrypted.get("linear.token")).toBe("secret-linear-value");
    expect(await readFile(path, "utf8")).not.toContain("secret-linear-value");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(
      new EncryptedFileSecretProvider(path, "incorrect password value").get("linear.token"),
    ).rejects.toThrow();

    const previous = process.env["FABLE_TEST_SECRET"];
    process.env["FABLE_TEST_SECRET"] = "environment-value";
    try {
      const memory = new InMemorySecretProvider();
      const composite = new CompositeSecretProvider([
        new EnvironmentSecretProvider({ "environment.secret": "FABLE_TEST_SECRET" }),
        memory,
      ]);
      await expect(composite.get("environment.secret")).resolves.toBe("environment-value");
      await composite.set("stored.secret", "stored-value");
      await expect(memory.get("stored.secret")).resolves.toBe("stored-value");
    } finally {
      if (previous === undefined) delete process.env["FABLE_TEST_SECRET"];
      else process.env["FABLE_TEST_SECRET"] = previous;
    }
  });
});
