import { CapabilitySet, type Capability } from "../domain/capabilities.js";
import { ConfigurationError } from "../domain/errors.js";
import type { Provider } from "../ports/providers.js";

export class ProviderRegistry<TProvider extends Provider> {
  readonly #providers = new Map<string, TProvider>();

  public register(provider: TProvider): void {
    if (this.#providers.has(provider.descriptor.id)) {
      throw new ConfigurationError(`Provider already registered: ${provider.descriptor.id}`);
    }
    this.#providers.set(provider.descriptor.id, provider);
  }

  public get(id: string): TProvider | undefined {
    return this.#providers.get(id);
  }

  public require(id: string): TProvider {
    const provider = this.get(id);
    if (provider === undefined) throw new ConfigurationError(`Unknown provider: ${id}`);
    return provider;
  }

  public list(): TProvider[] {
    return [...this.#providers.values()];
  }

  public async select(options: {
    id?: string;
    capabilities?: Capability[];
    requireAvailable?: boolean;
  }): Promise<TProvider> {
    const candidates = options.id === undefined ? this.list() : [this.require(options.id)];
    const required = options.capabilities ?? [];

    for (const provider of candidates) {
      if (!new CapabilitySet(provider.descriptor.capabilities).supportsAll(required)) continue;
      if (options.requireAvailable ?? true) {
        const availability = await provider.availability();
        if (!availability.available) continue;
      }
      return provider;
    }

    throw new ConfigurationError(
      `No suitable provider found${required.length === 0 ? "" : ` for: ${required.join(", ")}`}`,
    );
  }
}
