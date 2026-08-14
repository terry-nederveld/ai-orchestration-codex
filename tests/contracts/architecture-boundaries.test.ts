import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve("src");

describe("architecture boundaries", () => {
  it("keeps domain and ports independent of outer layers", async () => {
    const violations = await importViolations(
      ["domain", "ports"],
      ["application", "adapters", "composition", "control-plane", "cli"],
    );
    expect(violations).toEqual([]);
  });

  it("keeps application services independent of adapters", async () => {
    expect(await importViolations(["application"], ["adapters"])).toEqual([]);
  });
});

async function importViolations(layers: string[], forbidden: string[]): Promise<string[]> {
  const files = (
    await Promise.all(layers.map((layer) => typescriptFiles(resolve(sourceRoot, layer))))
  ).flat();
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const target of forbidden) {
      if (new RegExp(`from ["'][^"']*${target}(?:/|\\.)`).test(source)) {
        violations.push(`${file.replace(`${sourceRoot}/`, "")}: ${target}`);
      }
    }
  }
  return violations;
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}
