export const managedSectionStart = "<!-- fable:managed:start -->";
export const managedSectionEnd = "<!-- fable:managed:end -->";

export function updateManagedSection(content: string, managedMarkdown: string): string {
  if (
    managedMarkdown.includes(managedSectionStart) ||
    managedMarkdown.includes(managedSectionEnd)
  ) {
    throw new Error("Managed content may not contain Fable boundary markers");
  }
  const start = content.indexOf(managedSectionStart);
  const end = content.indexOf(managedSectionEnd);
  if ((start === -1) !== (end === -1)) throw new Error("Work item has a malformed managed section");
  if (start !== -1 && end < start) throw new Error("Managed section boundaries are out of order");
  const section = `${managedSectionStart}\n${managedMarkdown.trim()}\n${managedSectionEnd}`;
  if (start === -1) return `${content.replace(/\s+$/, "")}\n\n${section}\n`;
  const after = end + managedSectionEnd.length;
  return `${content.slice(0, start)}${section}${content.slice(after)}`;
}

export function readManagedSection(content: string): string | undefined {
  const start = content.indexOf(managedSectionStart);
  const end = content.indexOf(managedSectionEnd);
  if (start === -1 && end === -1) return undefined;
  if (start === -1 || end < start) throw new Error("Work item has a malformed managed section");
  return content.slice(start + managedSectionStart.length, end).trim();
}
