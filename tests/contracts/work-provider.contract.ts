import { expect } from "vitest";
import type { WorkProvider } from "../../src/ports/providers.js";

export async function assertWorkProviderContract(provider: WorkProvider): Promise<void> {
  expect(provider.descriptor.kind).toBe("work");
  const page = await provider.discover({ limit: 10 });
  expect(Array.isArray(page.items)).toBe(true);
  const item = page.items[0];
  if (item === undefined) return;

  await expect(provider.get(item.externalId)).resolves.toMatchObject({ id: item.id });
  const claim = await provider.claim(item, "contract-test", 10_000);
  expect(claim.workItemId).toBe(item.id);
  await provider.release(claim);
}
