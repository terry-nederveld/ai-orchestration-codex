import { describe, expect, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { HumanInputManager, WaitConditionManager } from "../../src/application/wait-manager.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";

describe("durable waits and human input", () => {
  it("persists across manager recreation and selects the first authorized response", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const authorizer = (_condition: unknown, signal: { actorId: string }) =>
      signal.actorId !== "stranger";
    const firstProcess = new WaitConditionManager(persistence, undefined, authorizer);
    const humans = new HumanInputManager(firstProcess);
    const condition = await humans.request({
      runId: "run-1",
      nodeId: "choose",
      checkpointKey: "run-1:choose:1",
      request: {
        type: "single_choice",
        title: "Choose an approach",
        description: "Select the approach to advance",
        channel: "both",
        required: true,
        choices: ["A", "B"],
        metadata: {},
      },
    });

    const secondProcess = new WaitConditionManager(persistence, undefined, authorizer);
    const resumedHumans = new HumanInputManager(secondProcess);
    await expect(
      resumedHumans.respond(condition.id, {
        source: "app",
        actorId: "stranger",
        value: "A",
      }),
    ).resolves.toMatchObject({ accepted: false, selected: false });
    await expect(
      resumedHumans.respond(condition.id, {
        id: "response-1",
        source: "app",
        actorId: "operator",
        value: "B",
        promote: true,
      }),
    ).resolves.toMatchObject({ accepted: true, selected: true });
    await expect(
      resumedHumans.respond(condition.id, {
        id: "response-2",
        source: "work_item",
        actorId: "reviewer",
        value: "A",
      }),
    ).resolves.toMatchObject({ accepted: true, selected: false });

    const stored = await secondProcess.get(condition.id);
    expect(stored).toMatchObject({ status: "satisfied", selectedSignalId: "response-1" });
    expect(stored?.signals).toHaveLength(2);
    expect(stored?.signals[1]?.supplemental).toBe(true);
  });

  it("is idempotent per checkpoint and never persists raw secret input", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const waits = new WaitConditionManager(persistence);
    const humans = new HumanInputManager(waits);
    const request = {
      runId: "run-2",
      nodeId: "credential",
      checkpointKey: "run-2:credential:1",
      request: {
        type: "secret" as const,
        title: "Credential needed",
        description: "Store the credential in the configured vault",
        channel: "app" as const,
        required: true,
        secretDestination: "deployment.token",
        metadata: {},
      },
    };
    const first = await humans.request(request);
    const duplicate = await humans.request(request);
    expect(duplicate.id).toBe(first.id);
    await expect(
      humans.respond(first.id, {
        source: "app",
        actorId: "operator",
        value: "plaintext-secret",
      }),
    ).rejects.toThrow(/invalid response/i);
    await humans.respond(first.id, {
      source: "app",
      actorId: "operator",
      value: { secretReference: "deployment.token" },
    });
    expect(JSON.stringify(await waits.get(first.id))).not.toContain("plaintext-secret");
  });

  it("enforces the declared response channel and emits normalized human-input events", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new InMemoryEventBus();
    const observed: string[] = [];
    events.subscribe("human_input.*", (event) => {
      observed.push(event.type);
    });
    const humans = new HumanInputManager(new WaitConditionManager(persistence, events));
    const condition = await humans.request({
      runId: "run-3",
      nodeId: "comment_only",
      checkpointKey: "run-3:comment_only",
      request: {
        type: "text",
        title: "Reply on the work item",
        description: "Provide clarification in the connected tracker",
        channel: "work_item",
        required: true,
        metadata: {},
      },
    });
    await expect(
      humans.respond(condition.id, { source: "app", actorId: "operator", value: "wrong" }),
    ).resolves.toMatchObject({ accepted: false, selected: false });
    await humans.respond(condition.id, {
      source: "work_item",
      actorId: "operator",
      value: "clarified",
    });
    expect(observed).toEqual(["human_input.requested", "human_input.received"]);
  });
});
