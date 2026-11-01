import { readFile, writeFile } from "node:fs/promises";

// Zod 3 UUIDs accepted all hex GUIDs, not only RFC version/variant bits.
// Its integer check also accepted integral numbers outside the safe range.
// Preserve those public contracts while using Zod 4's patched collections.
// Run after every Orval generation, never hand-edit generated validators.
const target = new URL("../api-zod/src/generated/api.ts", import.meta.url);
const source = await readFile(target, "utf8");
if (!source.includes("import * as zod from 'zod'")) {
  throw new Error("Unexpected Orval Zod import; review contract compatibility.");
}
await writeFile(target, source
  .replaceAll("zod.uuid()", "zod.guid()")
  .replaceAll("zod.int()", 'zod.number().refine(Number.isInteger, "Expected integer, received float")')
  .replaceAll("zod.coerce.number().int()", 'zod.coerce.number().refine(Number.isInteger, "Expected integer, received float")')
  // Zod 3 allowed omitted unknown-valued object properties.
  .replace(/(": zod\.unknown\(\))(?=[,\n])/g, "$1.optional()"));
