import { describe, expect, it } from "vitest";
import {
  managedSectionEnd,
  managedSectionStart,
  readManagedSection,
  updateManagedSection,
} from "../../src/application/managed-section.js";

describe("managed work-item sections", () => {
  it("preserves all human-authored content around an update", () => {
    const original = `Human introduction\n\n${managedSectionStart}\nOld summary\n${managedSectionEnd}\n\nHuman footer\n`;
    const updated = updateManagedSection(original, "## Current discovery\n\nCandidate B advanced.");
    expect(updated.startsWith("Human introduction\n\n")).toBe(true);
    expect(updated.endsWith("\n\nHuman footer\n")).toBe(true);
    expect(readManagedSection(updated)).toBe("## Current discovery\n\nCandidate B advanced.");
  });

  it("adds one section and rejects boundary injection", () => {
    const updated = updateManagedSection("Human description", "Status: investigating");
    expect(updated.match(/fable:managed:start/g)).toHaveLength(1);
    expect(() => updateManagedSection(updated, managedSectionStart)).toThrow(/boundary/i);
  });
});
