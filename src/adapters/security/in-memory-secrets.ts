import type { SecretProvider } from "../../ports/security.js";

export class InMemorySecretProvider implements SecretProvider {
  public readonly id = "in-memory";
  readonly #values = new Map<string, string>();

  public constructor(values: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(values)) this.#values.set(key, value);
  }

  public async available(): Promise<boolean> {
    return true;
  }

  public async get(reference: string): Promise<string | undefined> {
    return this.#values.get(reference);
  }

  public async set(reference: string, value: string): Promise<void> {
    this.#values.set(reference, value);
  }

  public async delete(reference: string): Promise<boolean> {
    return this.#values.delete(reference);
  }
}
