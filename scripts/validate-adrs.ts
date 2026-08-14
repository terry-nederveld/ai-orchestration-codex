import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

const directory = resolve("docs/adrs");
const files = (await readdir(directory)).filter((file) => /^adr-\d{4}\.md$/.test(file)).sort();
const requiredSections = [
  "# Context",
  "# Decision",
  "# Rationale",
  "# Alternatives Considered",
  "# Consequences",
  "# Implementation Notes",
  "# References",
];
const validStatuses = new Set(["proposed", "accepted", "deprecated", "superseded", "rejected"]);

let expected = 1;
for (const file of files) {
  const number = Number(file.slice(4, 8));
  if (number !== expected)
    throw new Error(`Expected adr-${String(expected).padStart(4, "0")}.md, got ${file}`);
  expected += 1;

  const contents = await readFile(resolve(directory, file), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(contents);
  if (match?.[1] === undefined) throw new Error(`${file}: missing YAML frontmatter`);
  const frontmatter = parseDocument(match[1]).toJS() as Record<string, unknown>;
  for (const field of [
    "adr",
    "title",
    "status",
    "date",
    "decision-makers",
    "tags",
    "supersedes",
    "superseded-by",
  ]) {
    if (!(field in frontmatter)) throw new Error(`${file}: missing frontmatter field ${field}`);
  }
  if (!validStatuses.has(String(frontmatter["status"]))) throw new Error(`${file}: invalid status`);
  if (String(frontmatter["adr"]).padStart(4, "0") !== file.slice(4, 8)) {
    throw new Error(`${file}: frontmatter ADR number does not match filename`);
  }
  for (const section of requiredSections) {
    if (!contents.includes(`\n${section}\n`))
      throw new Error(`${file}: missing section ${section}`);
  }
}

console.log(`Validated ${files.length} ADRs.`);
