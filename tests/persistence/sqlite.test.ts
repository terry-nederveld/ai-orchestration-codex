import { describe, it } from "vitest";
import { SqlitePersistenceProvider } from "../../src/adapters/persistence/sqlite.js";
import { assertPersistenceContract } from "./persistence.contract.js";

describe("SqlitePersistenceProvider", () => {
  it("satisfies the persistence contract", async () => {
    await assertPersistenceContract(new SqlitePersistenceProvider(":memory:"));
  });
});
