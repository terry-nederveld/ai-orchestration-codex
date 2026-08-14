import type { SecretProvider } from "../../ports/security.js";

export class CompositeSecretProvider implements SecretProvider {
  public readonly id = "composite";

  public constructor(
    private readonly providers: SecretProvider[],
    private readonly writableProviderId?: string,
  ) {}

  public async available(): Promise<boolean> {
    const states = await Promise.all(this.providers.map((provider) => provider.available()));
    return states.some(Boolean);
  }

  public async get(reference: string): Promise<string | undefined> {
    for (const provider of this.providers) {
      if (!(await provider.available())) continue;
      const value = await provider.get(reference);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  public async set(reference: string, value: string): Promise<void> {
    await this.#writable().set(reference, value);
  }

  public async delete(reference: string): Promise<boolean> {
    return this.#writable().delete(reference);
  }

  #writable(): SecretProvider {
    const provider =
      this.writableProviderId === undefined
        ? this.providers.find((candidate) => candidate.id !== "environment")
        : this.providers.find((candidate) => candidate.id === this.writableProviderId);
    if (provider === undefined) throw new Error("No writable secret provider is configured");
    return provider;
  }
}
