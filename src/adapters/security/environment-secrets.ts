import type { SecretProvider } from "../../ports/security.js";

export class EnvironmentSecretProvider implements SecretProvider {
  public readonly id = "environment";

  public constructor(private readonly mappings: Record<string, string> = {}) {}

  public async available(): Promise<boolean> {
    return true;
  }

  public async get(reference: string): Promise<string | undefined> {
    const name = this.mappings[reference] ?? reference;
    return process.env[name];
  }

  public async set(): Promise<void> {
    throw new Error("Environment secrets are read-only");
  }

  public async delete(): Promise<boolean> {
    throw new Error("Environment secrets are read-only");
  }
}
