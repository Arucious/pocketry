import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { libraryBackupSchema } from "./library";
import { parseProjectDoc, projectDocSchema, serializeProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";
import golden from "./fixtures/upstream-sample-migrations.json";

// References come from a clean pinned upstream checkout using its original
// lockfile. The reproduction adapter is in scripts/fixtures; never replace
// these hashes with fork output just to make a compatibility failure pass.
function canonicalJson(value: unknown): string {
  // The new optional profile changes the format tag, not any legacy geometry.
  // Keep the independently reproduced hashes; normalize only project version
  // tags to the pinned baseline when comparing old documents.
  const baselineVersion = Math.max(...golden.cases.map(c => c.outputSchemaVersion));
  const sort = (data: unknown): unknown => {
    if (Array.isArray(data)) return data.map(sort);
    if (data !== null && typeof data === "object") {
      const record = data as Record<string, unknown>;
      return Object.fromEntries(Object.keys(data).sort().map(key =>
        [key, key === "schemaVersion" && record.schemaVersion === PROJECT_SCHEMA_VERSION && "cutouts" in record && "shapes" in record
          ? baselineVersion : sort(record[key])],
      ));
    }
    return data;
  };
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

function migrate(input: unknown) {
  const project = parseProjectDoc(input);
  expect(project).not.toBeNull();
  if (!project) throw new Error("An upstream-compatible project was rejected");
  expect(projectDocSchema.safeParse(project).success).toBe(true);
  return project;
}

describe(`saved-project compatibility with upstream ${golden.upstreamCommit}`, () => {
  it.each(golden.cases)("preserves $case", reference => {
    const bytes = readFileSync(new URL(`../../${reference.sourceFile}`, import.meta.url));
    expect(sha256(bytes), "The pinned upstream input changed; review fresh baseline evidence")
      .toBe(reference.sourceSha256);
    const source: unknown = JSON.parse(bytes.toString("utf8"));

    if (reference.kind === "library") {
      const library = libraryBackupSchema.parse(source);
      expect(sha256(canonicalJson(library))).toBe(reference.parsedSha256);
      const migrated = { ...library, projects: library.projects.map(project =>
        ({ ...project, doc: migrate(project.doc) })),
      };
      expect(sha256(canonicalJson(migrated))).toBe(reference.migratedSha256);
      const serialized = { ...migrated, projects: migrated.projects.map(project =>
        ({ ...project, doc: serializeProjectDoc(project.doc) })),
      };
      expect(sha256(canonicalJson(serialized))).toBe(reference.serializedSha256);
      const restored = libraryBackupSchema.parse(JSON.parse(JSON.stringify(serialized)));
      expect(restored.projects.map(project => project.id)).toEqual(library.projects.map(project => project.id));
      expect(canonicalJson({ ...restored, projects: restored.projects.map(project =>
        ({ ...project, doc: migrate(project.doc) })),
      })).toBe(canonicalJson(migrated));
      return;
    }

    const input = reference.kind === "library-project"
      ? libraryBackupSchema.parse(source).projects.find(project => project.id === reference.libraryProjectId)?.doc
      : source;
    const parsed = migrate(input);
    expect(parsed.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(sha256(canonicalJson(parsed))).toBe(reference.parsedSha256);
    expect(canonicalJson(migrate(input))).toBe(canonicalJson(parsed));
    const serialized = serializeProjectDoc(parsed);
    expect(sha256(canonicalJson(serialized))).toBe(reference.serializedSha256);
    const restored = migrate(JSON.parse(JSON.stringify(serialized)));
    expect(canonicalJson(restored)).toBe(canonicalJson(parsed));
    expect(canonicalJson(serializeProjectDoc(restored))).toBe(canonicalJson(serialized));
  });
});
