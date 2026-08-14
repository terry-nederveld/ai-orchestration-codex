import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { EventFactory } from "../../src/application/events.js";

describe("InMemoryEventBus", () => {
  it("delivers exact and namespace wildcard subscriptions", async () => {
    const bus = new InMemoryEventBus();
    const exact = vi.fn();
    const wildcard = vi.fn();
    const unrelated = vi.fn();
    bus.subscribe("agent.started", exact);
    bus.subscribe("agent.*", wildcard);
    bus.subscribe("tool.*", unrelated);

    const event = new EventFactory({ source: "test" }).create("agent.started", { run: "1" });
    await bus.publish(event);

    expect(exact).toHaveBeenCalledWith(event);
    expect(wildcard).toHaveBeenCalledWith(event);
    expect(unrelated).not.toHaveBeenCalled();
  });
});
