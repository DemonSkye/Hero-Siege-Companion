const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { validateItemDataShape } = require("./item-data-schema.cjs");
const folder = path.join(root, "src/shared/data/items/build-24868792");
const sources = Object.fromEntries(Object.entries({ identities: "identities", constructors: "constructor-stats",
  statCatalog: "item-stats", runewords: "runewords", rarities: "rarities", listingCoverage: "listing-coverage" })
  .map(([name, file]) => [name, JSON.parse(fs.readFileSync(path.join(folder, `${file}.json`), "utf8"))]));
const shapeIssues = validateItemDataShape(sources);
if (shapeIssues.length) throw new Error(`Invalid item data shape:\n${shapeIssues.join("\n")}`);
const { validateItemData } = require(path.join(root, "dist/main/shared/item-data-validation.js"));
const issues = validateItemData(sources);
if (issues.length) throw new Error(`Invalid item data:\n${issues.join("\n")}`);
const command = process.argv[2];
if (command === "check") {
  console.log("Item data valid: identities, stat IDs, constructor values, roles, bindings and coverage.");
} else if (command === "export") {
  const { Items } = require(path.join(root, "dist/main/shared/items.js"));
  const { ITEM_DATA_SOURCES } = require(path.join(root, "dist/main/shared/item-data-validation.js"));
  const output = path.join(root, "out/item-data");
  fs.mkdirSync(output, { recursive: true });
  const exported = { schemaVersion: 1, provenance: ITEM_DATA_SOURCES.identities.provenance,
    currentBuildParity: "unverified", classificationSource: ITEM_DATA_SOURCES.rarities.source, items: Items };
  fs.writeFileSync(path.join(output, "items.json"), JSON.stringify(exported, null, 2) + "\n");
  fs.writeFileSync(path.join(output, "item-stats.json"), JSON.stringify(ITEM_DATA_SOURCES.statCatalog, null, 2) + "\n");
  console.log(`Exported deterministic item data to ${output}`);
} else {
  throw new Error("Usage: npm run catalog:check or npm run catalog:export");
}
