const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ITEM_LOOKUP_PATH = path.join(ROOT, "src", "shared", "item-lookup.ts");
const STACK_LOOKUP_PATH = path.join(ROOT, "src", "shared", "stack-item-lookup.ts");
const ITEM_CATALOG_PATH = path.join(ROOT, "src", "shared", "item-catalog.ts");
const STACK_TYPES = new Set([12, 13, 14, 15]);
const REPOSITORIES = new Set(["normal", "unique", "runeword", "unknown"]);
const CLASSIFICATIONS = new Set(["unknown-normal", "stack-item", "material-collectible", "generated-placeholder", "known-missing-icon"]);
const GENERIC_LABEL_PATTERN = /(?:^|\s)(?:type|item|weapon|helmet|chest|boots|gloves|amulet|shield|ring|belt|charm|consumable|vial|collectible|material|relic|socketable|key|sword|dagger|mace|axe|claw|polearm|chainsaw|staff|cane|wand|book|spellblade|bow|gun|flask|throwing|novelty)(?:\s+type)?(?:\s+\d+)?\s+#\d+/i;

const {
  activeItemCatalog,
  requiresItemIdentification,
} = loadSharedItemCatalog();

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || options.files.length === 0) {
    printUsage(options.files.length === 0 ? 1 : 0);
    return;
  }

  const review = buildResearchReview(options.files.map(readResearchFile));
  const markdown = renderReviewMarkdown(review);
  const suggestionsJson = JSON.stringify({ generatedAt: review.generatedAt, suggestions: review.suggestions }, null, 2);

  if (options.outDir) {
    fs.mkdirSync(options.outDir, { recursive: true });
    const markdownPath = path.join(options.outDir, "item-research-review.md");
    const suggestionsPath = path.join(options.outDir, "item-research-suggestions.json");
    fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8");
    fs.writeFileSync(suggestionsPath, `${suggestionsJson}\n`, "utf8");
    console.log(`Wrote ${path.relative(process.cwd(), markdownPath)}`);
    console.log(`Wrote ${path.relative(process.cwd(), suggestionsPath)}`);
    return;
  }

  console.log(markdown);
  console.log("\n```json");
  console.log(suggestionsJson);
  console.log("```");
}

function parseArgs(argv) {
  const options = { files: [], outDir: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--out-dir" || arg === "-o") {
      const outDir = argv[index + 1];
      if (!outDir) throw new Error(`${arg} requires a directory`);
      options.outDir = path.resolve(outDir);
      index += 1;
      continue;
    }
    options.files.push(path.resolve(arg));
  }
  return options;
}

function printUsage(exitCode) {
  const lines = [
    "Usage: node scripts/review-item-research.js [--out-dir <dir>] <hero-siege-item-research.json> [...]",
    "",
    "Reads exported item research JSON files and generates maintainer review output.",
    "Without --out-dir, the Markdown report and suggestion JSON are printed to stdout.",
  ];
  console.log(lines.join("\n"));
  process.exitCode = exitCode;
}

function readResearchFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : [];
  return {
    filePath,
    entries: entries.map((entry) => normalizeEntry(entry, filePath)).filter(Boolean),
  };
}

function normalizeEntry(entry, filePath) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const type = numberField(entry.type);
  const id = numberField(entry.id);
  const repository = normalizeRepository(entry.repository);
  const weaponType = entry.weaponType === undefined || entry.weaponType === null || entry.weaponType === ""
    ? 0
    : numberField(entry.weaponType);
  const dropQuality = numberField(entry.dropQuality);
  const label = cleanText(entry.label || "");
  const resolvedName = cleanText(entry.resolvedName || "");
  const localizationId = cleanText(entry.localizationId || "");
  const ignored = Boolean(entry.ignored);
  const count = Math.max(1, numberField(entry.count) || 1);
  const classification = normalizeClassification(entry.classification, type, id, label);
  return {
    filePath,
    signature: cleanText(entry.signature || `${repository}:${type}:${id}:${weaponType}:${dropQuality}:${label.toLowerCase()}`),
    label: label || `Type ${type} #${id}`,
    resolvedName,
    resolvedNameKey: normalizeNameKey(resolvedName),
    rarity: cleanText(entry.rarity || "Unknown"),
    type,
    id,
    repository,
    weaponType,
    dropQuality,
    classification,
    count,
    ignored,
    notes: cleanText(entry.notes || ""),
    ...(localizationId ? { localizationId } : {}),
  };
}

function buildResearchReview(files, options = {}) {
  const catalogResolver = options.catalogResolver ?? activeItemCatalog;
  const existing = readExistingLookupIndex();
  const groups = new Map();
  const noisyEntries = [];

  for (const file of files) {
    for (const entry of file.entries) {
      const invalidReason = invalidEntryReason(entry);
      if (invalidReason) {
        noisyEntries.push({ entry, reason: invalidReason });
        continue;
      }
      if (entry.ignored) {
        noisyEntries.push({ entry, reason: "ignored" });
        continue;
      }

      const key = groupKey(entry);
      const group = groups.get(key) ?? {
        key,
        type: entry.type,
        id: entry.id,
        repository: entry.repository,
        weaponType: entry.weaponType,
        dropQuality: entry.dropQuality,
        entries: [],
        count: 0,
        files: new Set(),
        labels: new Set(),
        localizationIds: new Set(),
        classifications: new Map(),
        resolvedNames: new Map(),
      };
      group.entries.push(entry);
      group.count += entry.count;
      group.files.add(path.basename(entry.filePath));
      group.labels.add(entry.label);
      if (entry.localizationId) group.localizationIds.add(entry.localizationId);
      const classificationCount = group.classifications.get(entry.classification) ?? 0;
      group.classifications.set(entry.classification, classificationCount + entry.count);
      if (entry.resolvedNameKey) {
        const values = group.resolvedNames.get(entry.resolvedNameKey) ?? new Set();
        values.add(entry.resolvedName);
        group.resolvedNames.set(entry.resolvedNameKey, values);
      }
      groups.set(key, group);
    }
  }

  const conflicts = [];
  const unresolved = [];
  const alreadyKnown = [];
  const missingIcons = [];
  const suggestions = [];
  const candidateGroups = [];

  for (const group of [...groups.values()].sort(compareGroups)) {
    const resolvedKeys = [...group.resolvedNames.keys()];
    const classification = primaryClassification(group);

    if (classification === "generated-placeholder") {
      noisyEntries.push({ entry: group.entries[0], reason: "generated placeholder" });
      continue;
    }

    if (classification === "known-missing-icon") {
      missingIcons.push(groupSummary(group, "known item missing icon"));
      continue;
    }

    const catalogResolution = resolveCatalogGroup(group, classification, catalogResolver);
    if (catalogResolution.status === "resolved") {
      const catalogName = catalogDefinitionName(catalogResolution.definition);
      if (catalogResolution.definition.identityMode === "seeded") {
        noisyEntries.push({
          entry: group.entries[0],
          reason: "seeded catalog identity; rolled names are instance-specific",
        });
        continue;
      }

      const catalogNameKey = normalizeNameKey(catalogName);
      const conflictingNames = resolvedKeys.filter((nameKey) => nameKey !== catalogNameKey);
      if (conflictingNames.length > 0) {
        conflicts.push(groupSummary(
          group,
          `resolved name conflicts with catalog identity: ${catalogName}`,
        ));
      } else {
        alreadyKnown.push({
          ...groupSummary(group, "already known from generated catalog"),
          resolvedName: catalogName,
          existingName: catalogName,
        });
      }
      continue;
    }

    if (!requiresItemIdentification(catalogResolution)) {
      noisyEntries.push({
        entry: group.entries[0],
        reason: `seeded catalog ${catalogResolution.status}; rolled names cannot become fixed lookup suggestions`,
      });
      continue;
    }

    if (resolvedKeys.length === 0) {
      unresolved.push(groupSummary(group, "unresolved"));
      continue;
    }

    if (resolvedKeys.length > 1) {
      conflicts.push(groupSummary(group, "conflicting resolved names"));
      continue;
    }

    const resolvedName = [...group.resolvedNames.values()][0].values().next().value;
    if (GENERIC_LABEL_PATTERN.test(resolvedName)) {
      noisyEntries.push({ entry: group.entries[0], reason: "resolved name still looks generic" });
      continue;
    }

    if (group.type === 3 && group.weaponType <= 0) {
      conflicts.push(groupSummary(group, "weapon type requires manual review"));
      continue;
    }

    if (group.repository === "unknown") {
      conflicts.push(groupSummary(group, "repository requires manual review"));
      continue;
    }

    if (group.repository === "runeword") {
      conflicts.push(groupSummary(group, "runeword packet selector requires manual review"));
      continue;
    }

    if (group.type !== 3 && group.weaponType !== 0 && !STACK_TYPES.has(group.type)) {
      conflicts.push(groupSummary(group, "non-weapon item subtype requires manual review"));
      continue;
    }

    if (STACK_TYPES.has(group.type) && group.repository !== "normal") {
      conflicts.push(groupSummary(group, "stack item repository requires manual review"));
      continue;
    }

    if (STACK_TYPES.has(group.type) && group.weaponType !== 0) {
      conflicts.push(groupSummary(group, "stack item weapon subtype requires manual review"));
      continue;
    }

    candidateGroups.push(group);
  }

  const candidatesByIdentity = new Map();
  for (const group of candidateGroups) {
    const key = catalogTargetKey(group);
    const identityGroups = candidatesByIdentity.get(key) ?? [];
    identityGroups.push(group);
    candidatesByIdentity.set(key, identityGroups);
  }

  for (const identityGroups of candidatesByIdentity.values()) {
    const group = mergeIdentityGroups(identityGroups);
    const resolvedKeys = [...group.resolvedNames.keys()];
    if (resolvedKeys.length > 1) {
      conflicts.push(groupSummary(group, "drop qualities resolve to conflicting names for one catalog identity"));
      continue;
    }

    const resolvedName = [...group.resolvedNames.values()][0].values().next().value;
    const classification = primaryClassification(group);
    const existingNames = existing.byIdentity.get(identityKey(group.repository, group.type, group.id, group.weaponType)) ?? [];

    const existingMatch = existingNames.find((name) => normalizeNameKey(name) === normalizeNameKey(resolvedName));
    if (existingMatch) {
      alreadyKnown.push({ ...groupSummary(group, "already known"), resolvedName, existingName: existingMatch });
      continue;
    }
    if (existingNames.length > 0) {
      conflicts.push(groupSummary(
        group,
        `resolved name conflicts with existing catalog identity: ${existingNames.join(" | ")}`,
      ));
      continue;
    }

    suggestions.push({
      key: group.key,
      target: STACK_TYPES.has(group.type) && group.repository === "normal" ? "src/shared/stack-item-lookup.ts" : "src/shared/item-lookup.ts",
      type: group.type,
      id: group.id,
      repository: group.repository,
      weaponType: group.weaponType,
      dropQuality: group.dropQuality,
      classification,
      resolvedName,
      count: group.count,
      files: [...group.files].sort(),
      labels: [...group.labels].sort(),
      localizationIds: [...group.localizationIds].sort(),
      existingNames,
      suggestedLine: suggestedLookupLine(group, resolvedName),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    files: files.map((file) => ({ filePath: file.filePath, entryCount: file.entries.length })),
    groupCount: groups.size,
    suggestions,
    conflicts,
    unresolved,
    alreadyKnown,
    missingIcons,
    noisyEntries,
  };
}

function catalogTargetKey(group) {
  if (STACK_TYPES.has(group.type) && group.repository === "normal") return `stack:${group.type}:${group.id}`;
  return identityKey(group.repository, group.type, group.id, group.weaponType);
}

function mergeIdentityGroups(groups) {
  if (groups.length === 1) return groups[0];
  const sorted = [...groups].sort(compareGroups);
  const first = sorted[0];
  const merged = {
    ...first,
    entries: [],
    count: 0,
    files: new Set(),
    labels: new Set(),
    localizationIds: new Set(),
    classifications: new Map(),
    resolvedNames: new Map(),
  };

  for (const group of sorted) {
    merged.entries.push(...group.entries);
    merged.count += group.count;
    for (const file of group.files) merged.files.add(file);
    for (const label of group.labels) merged.labels.add(label);
    for (const localizationId of group.localizationIds) merged.localizationIds.add(localizationId);
    for (const [classification, count] of group.classifications) {
      merged.classifications.set(classification, (merged.classifications.get(classification) ?? 0) + count);
    }
    for (const [nameKey, names] of group.resolvedNames) {
      const mergedNames = merged.resolvedNames.get(nameKey) ?? new Set();
      for (const name of names) mergedNames.add(name);
      merged.resolvedNames.set(nameKey, mergedNames);
    }
  }

  return merged;
}

function readExistingLookupIndex() {
  const byIdentity = new Map();
  const itemSource = fs.readFileSync(ITEM_LOOKUP_PATH, "utf8");
  const baseRows = parseLookupRows(itemSource, "ITEM_TRANSLATION_ROWS", "unique");
  const overrideRows = parseLookupRows(itemSource, "ITEM_TRANSLATION_OVERRIDES", "unique");
  const overrideKeys = new Set(overrideRows.map((row) => lookupRowIdentityKey(row)));
  const overrideLocalizationIds = new Set(overrideRows.map((row) => lookupRowLocalizationKey(row)));
  const baseGroups = new Map();

  for (const row of baseRows) {
    const key = lookupRowIdentityKey(row);
    const group = baseGroups.get(key) ?? [];
    group.push(row);
    baseGroups.set(key, group);
  }

  for (const [key, group] of baseGroups) {
    const row = group[0];
    if (group.length !== 1 || overrideKeys.has(key) || overrideLocalizationIds.has(lookupRowLocalizationKey(row))) continue;
    addExistingLookup(byIdentity, row);
  }

  const overridesByIdentity = new Map();
  for (const row of overrideRows) overridesByIdentity.set(lookupRowIdentityKey(row), row);
  for (const row of overridesByIdentity.values()) addExistingLookup(byIdentity, row);

  const stackSource = fs.readFileSync(STACK_LOOKUP_PATH, "utf8");
  const stackRows = parseLookupRows(stackSource, "STACK_ITEM_TRANSLATION_ROWS", "normal");
  const stackRowsByRuntimeKey = new Map();
  for (const row of stackRows) stackRowsByRuntimeKey.set(`${row.type}:${row.gameId}`, row);
  for (const row of stackRowsByRuntimeKey.values()) addExistingLookup(byIdentity, row);

  return { byIdentity };
}

function parseLookupRows(source, arrayName, defaultRepository) {
  const declarationStart = source.indexOf(`const ${arrayName}`);
  const assignmentStart = source.indexOf("=", declarationStart);
  const arrayStart = source.indexOf("[", assignmentStart);
  const arrayEnd = source.indexOf("];", arrayStart);
  if (declarationStart < 0 || assignmentStart < 0 || arrayStart < 0 || arrayEnd < 0) {
    throw new Error(`Could not read ${arrayName} from the existing lookup source.`);
  }

  const rows = [];
  const pattern = /\{[^{}\r\n]*\blocalizationId:\s*"[^"]+"[^{}\r\n]*\}/g;
  const arraySource = source.slice(arrayStart + 1, arrayEnd);
  let match;
  while ((match = pattern.exec(arraySource))) {
    const row = match[0];
    const localizationIdMatch = row.match(/\blocalizationId:\s*"((?:\\.|[^"])*)"/);
    const nameMatch = row.match(/\bname:\s*"((?:\\.|[^"])*)"/);
    const gameIdMatch = row.match(/\bgameId:\s*(-?\d+)/);
    const typeMatch = row.match(/\btype:\s*(-?\d+)/);
    const weaponTypeMatch = row.match(/\bweaponType:\s*(-?\d+)/);
    if (!localizationIdMatch || !nameMatch || !gameIdMatch || !typeMatch || !weaponTypeMatch) continue;
    const repositoryMatch = row.match(/\brepository:\s*"([^"]+)"/);
    rows.push({
      localizationId: parseTsString(localizationIdMatch[1]),
      name: parseTsString(nameMatch[1]),
      gameId: Number(gameIdMatch[1]),
      type: Number(typeMatch[1]),
      weaponType: Number(weaponTypeMatch[1]),
      repository: repositoryMatch ? normalizeRepository(repositoryMatch[1]) : defaultRepository,
    });
  }
  return rows;
}

function addExistingLookup(byIdentity, row) {
  byIdentity.set(lookupRowIdentityKey(row), [row.name]);
}

function resolveCatalogGroup(group, classification, catalogResolver) {
  const repository = group.repository === "unknown" && classification === "unknown-normal"
    ? "normal"
    : group.repository;
  if (repository === "unknown") {
    return { status: "unclassified", key: null, reason: "no-domain" };
  }
  return catalogResolver.resolve({
    repository,
    type: group.type,
    gameId: group.id,
    weaponType: group.type === 3 ? group.weaponType : 0,
  });
}

function catalogDefinitionName(definition) {
  return definition.identityMode === "seeded" ? definition.baseName : definition.name;
}

function lookupRowIdentityKey(row) {
  return identityKey(row.repository, row.type, row.gameId, row.weaponType);
}

function lookupRowLocalizationKey(row) {
  return `${row.repository}:${row.localizationId}`;
}

function renderReviewMarkdown(review) {
  const lines = [
    "# Item Research Review",
    "",
    `Generated: ${review.generatedAt}`,
    "",
    "## Inputs",
    "",
    ...review.files.map((file) => `- ${path.basename(file.filePath)}: ${file.entryCount} entries`),
    "",
    "## Summary",
    "",
    `- Grouped signatures: ${review.groupCount}`,
    `- Suggested lookup changes: ${review.suggestions.length}`,
    `- Conflicts: ${review.conflicts.length}`,
    `- Unresolved groups: ${review.unresolved.length}`,
    `- Already known groups: ${review.alreadyKnown.length}`,
    `- Known missing-icon groups: ${review.missingIcons.length}`,
    `- Ignored/noisy entries: ${review.noisyEntries.length}`,
    "",
    "## Suggested Lookup Changes",
    "",
  ];

  if (!review.suggestions.length) {
    lines.push("No safe single-name suggestions found.", "");
  } else {
    for (const suggestion of review.suggestions) {
      lines.push(`### ${suggestion.resolvedName}`);
      lines.push("");
      lines.push(`- Key: \`${suggestion.key}\``);
      lines.push(`- Repository: ${suggestion.repository}`);
      lines.push(`- Weapon subtype: ${suggestion.weaponType}`);
      lines.push(`- Target: \`${suggestion.target}\``);
      lines.push(`- Classification: ${classificationLabel(suggestion.classification)}`);
      lines.push(`- Count: ${suggestion.count}`);
      lines.push(`- Files: ${suggestion.files.join(", ")}`);
      if (suggestion.localizationIds.length) lines.push(`- Observed localization IDs: ${suggestion.localizationIds.join(", ")}`);
      if (suggestion.existingNames.length) lines.push(`- Existing same type/id/subtype names: ${suggestion.existingNames.join(", ")}`);
      lines.push("");
      lines.push("```ts");
      lines.push(suggestion.suggestedLine);
      lines.push("```");
      lines.push("");
    }
  }

  appendGroupSection(lines, "Conflicts", review.conflicts);
  appendGroupSection(lines, "Unresolved Groups", review.unresolved);
  appendGroupSection(lines, "Already Known", review.alreadyKnown);
  appendGroupSection(lines, "Known Missing Icons", review.missingIcons);

  lines.push("## Ignored Or Noisy Entries", "");
  if (!review.noisyEntries.length) {
    lines.push("None.", "");
  } else {
    for (const item of review.noisyEntries) {
      lines.push(`- ${item.reason}: \`${groupKey(item.entry)}\` ${item.entry.label}${item.entry.resolvedName ? ` -> ${item.entry.resolvedName}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function appendGroupSection(lines, title, groups) {
  lines.push(`## ${title}`, "");
  if (!groups.length) {
    lines.push("None.", "");
    return;
  }
  for (const group of groups) {
    lines.push(`- \`${group.key}\` repository ${group.repository}, weapon subtype ${group.weaponType}, count ${group.count}: ${group.names.join(" | ")} (${group.files.join(", ")}) - ${classificationLabel(group.classification)}; ${group.reason}`);
  }
  lines.push("");
}

function groupSummary(group, reason) {
  const names = [...group.resolvedNames.values()].flatMap((values) => [...values]);
  return {
    key: group.key,
    type: group.type,
    id: group.id,
    repository: group.repository,
    weaponType: group.weaponType,
    dropQuality: group.dropQuality,
    count: group.count,
    files: [...group.files].sort(),
    labels: [...group.labels].sort(),
    localizationIds: [...group.localizationIds].sort(),
    names: names.length ? names.sort() : [...group.labels].sort(),
    classification: primaryClassification(group),
    reason,
  };
}

function suggestedLookupLine(group, resolvedName) {
  const localizationPrefix = STACK_TYPES.has(group.type) && group.repository === "normal" ? "stack" : "research";
  const observedLocalizationIds = [...group.localizationIds];
  const localizationId = observedLocalizationIds.length === 1
    ? observedLocalizationIds[0]
    : `${localizationPrefix}_${slugName(resolvedName)}_${group.repository}_${group.type}_${group.id}_${group.weaponType}_${group.dropQuality}`;
  return `{ localizationId: "${escapeTsString(localizationId)}", name: "${escapeTsString(resolvedName)}", gameId: ${group.id}, type: ${group.type}, weaponType: ${group.weaponType}, repository: "${group.repository}" },`;
}

function invalidEntryReason(entry) {
  if (!Number.isFinite(entry.type) || entry.type < 0) return "invalid type";
  if (!Number.isFinite(entry.id) || entry.id < 0) return "invalid id";
  if (!REPOSITORIES.has(entry.repository)) return "invalid repository";
  if (!Number.isFinite(entry.weaponType) || entry.weaponType < 0) return "invalid weaponType";
  if (!Number.isFinite(entry.dropQuality)) return "invalid dropQuality";
  return "";
}

function normalizeClassification(value, type, id, label) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (CLASSIFICATIONS.has(normalized)) return normalized;
  if (!label || /^unknown item$/i.test(label) || /\bseed\s+\d+/i.test(label)) return "generated-placeholder";
  if (type === 13 || type === 14) return "material-collectible";
  if (type === 12 || type === 15) return "stack-item";
  return "unknown-normal";
}

function primaryClassification(group) {
  if (!group.classifications?.size) return normalizeClassification("", group.type, group.id, [...group.labels][0] ?? "");
  return [...group.classifications.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
}

function classificationLabel(classification) {
  return {
    "unknown-normal": "Unknown normal item",
    "stack-item": "Stack item",
    "material-collectible": "Material or collectible",
    "generated-placeholder": "Generated placeholder",
    "known-missing-icon": "Known item, missing icon",
  }[classification] ?? "Unknown normal item";
}

function compareGroups(left, right) {
  return left.type - right.type || left.id - right.id || left.weaponType - right.weaponType || left.dropQuality - right.dropQuality || left.repository.localeCompare(right.repository) || left.key.localeCompare(right.key);
}

function groupKey(entry) {
  return `${entry.repository}:${entry.type}:${entry.id}:${entry.weaponType}:${entry.dropQuality}`;
}

function identityKey(repository, type, id, weaponType) {
  return `${repository}:${type}:${id}:${weaponType}`;
}

function normalizeRepository(value) {
  const repository = cleanText(value).toLowerCase();
  return REPOSITORIES.has(repository) ? repository : "unknown";
}

function numberField(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : Number.NaN;
}

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeNameKey(value) {
  return cleanText(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/['\u2019]/g, "");
}

function slugName(value) {
  return normalizeNameKey(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "item";
}

function parseTsString(value) {
  return JSON.parse(`"${value}"`);
}

function escapeTsString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function loadSharedItemCatalog() {
  const typescript = require("typescript");
  const previousTsLoader = require.extensions[".ts"];
  require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = typescript.transpileModule(source, {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };

  try {
    return require(ITEM_CATALOG_PATH);
  } finally {
    if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
    else delete require.extensions[".ts"];
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  buildResearchReview,
  renderReviewMarkdown,
  readResearchFile,
};
