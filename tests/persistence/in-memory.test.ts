import { describe, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { assertPersistenceContract } from "./persistence.contract.js";

describe("InMemoryPersistenceProvider", () => {
  it("satisfies the persistence contract", async () => {
    await assertPersistenceContract(new InMemoryPersistenceProvider());
  });
});
