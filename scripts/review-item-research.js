const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ITEM_LOOKUP_PATH = path.join(ROOT, "src", "shared", "item-lookup.ts");
const STACK_LOOKUP_PATH = path.join(ROOT, "src", "shared", "stack-item-lookup.ts");
const STACK_TYPES = new Set([12, 13, 14, 15]);
const CLASSIFICATIONS = new Set(["unknown-normal", "stack-item", "material-collectible", "generated-placeholder", "known-missing-icon"]);
const GENERIC_LABEL_PATTERN = /(?:^|\s)(?:type|item|weapon|helmet|chest|boots|gloves|amulet|shield|ring|belt|charm|consumable|vial|collectible|material|socketable|key|sword|dagger|mace|axe|claw|polearm|chainsaw|staff|cane|wand|book|spellblade|bow|gun|flask|throwing|novelty)\s+#\d+/i;

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
  const dropQuality = numberField(entry.dropQuality);
  const label = cleanText(entry.label || "");
  const resolvedName = cleanText(entry.resolvedName || "");
  const ignored = Boolean(entry.ignored);
  const count = Math.max(1, numberField(entry.count) || 1);
  const classification = normalizeClassification(entry.classification, type, id, label);
  return {
    filePath,
    signature: cleanText(entry.signature || `${type}:${id}:${dropQuality}:${label.toLowerCase()}`),
    label: label || `Type ${type} #${id}`,
    resolvedName,
    resolvedNameKey: normalizeNameKey(resolvedName),
    rarity: cleanText(entry.rarity || "Unknown"),
    type,
    id,
    dropQuality,
    classification,
    count,
    ignored,
    notes: cleanText(entry.notes || ""),
  };
}

function buildResearchReview(files) {
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
        dropQuality: entry.dropQuality,
        entries: [],
        count: 0,
        files: new Set(),
        labels: new Set(),
        classifications: new Map(),
        resolvedNames: new Map(),
      };
      group.entries.push(entry);
      group.count += entry.count;
      group.files.add(path.basename(entry.filePath));
      group.labels.add(entry.label);
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

  for (const group of [...groups.values()].sort(compareGroups)) {
    const resolvedKeys = [...group.resolvedNames.keys()];
    const existingNames = existing.byTypeId.get(typeIdKey(group.type, group.id)) ?? [];
    const classification = primaryClassification(group);

    if (classification === "generated-placeholder") {
      noisyEntries.push({ entry: group.entries[0], reason: "generated placeholder" });
      continue;
    }

    if (classification === "known-missing-icon") {
      missingIcons.push(groupSummary(group, "known item missing icon"));
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

    if (group.type === 3) {
      conflicts.push(groupSummary(group, "weapon type requires manual review"));
      continue;
    }

    const existingMatch = existingNames.find((name) => normalizeNameKey(name) === normalizeNameKey(resolvedName));
    if (existingMatch) {
      alreadyKnown.push({ ...groupSummary(group, "already known"), resolvedName, existingName: existingMatch });
      continue;
    }

    suggestions.push({
      key: group.key,
      target: STACK_TYPES.has(group.type) ? "src/shared/stack-item-lookup.ts" : "src/shared/item-lookup.ts",
      type: group.type,
      id: group.id,
      dropQuality: group.dropQuality,
      classification,
      resolvedName,
      count: group.count,
      files: [...group.files].sort(),
      labels: [...group.labels].sort(),
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

function readExistingLookupIndex() {
  const byTypeId = new Map();
  for (const filePath of [ITEM_LOOKUP_PATH, STACK_LOOKUP_PATH]) {
    const source = fs.readFileSync(filePath, "utf8");
    const pattern = /\{\s*localizationId:\s*"[^"]+",\s*name:\s*"((?:\\"|[^"])*)",\s*gameId:\s*(-?\d+),\s*type:\s*(-?\d+),\s*weaponType:\s*(-?\d+)/g;
    let match;
    while ((match = pattern.exec(source))) {
      const name = parseTsString(match[1]);
      const gameId = Number(match[2]);
      const type = Number(match[3]);
      const key = typeIdKey(type, gameId);
      const names = byTypeId.get(key) ?? [];
      names.push(name);
      byTypeId.set(key, names);
    }
  }
  return { byTypeId };
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
      lines.push(`- Target: \`${suggestion.target}\``);
      lines.push(`- Classification: ${classificationLabel(suggestion.classification)}`);
      lines.push(`- Count: ${suggestion.count}`);
      lines.push(`- Files: ${suggestion.files.join(", ")}`);
      if (suggestion.existingNames.length) lines.push(`- Existing same type/id names: ${suggestion.existingNames.join(", ")}`);
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
    lines.push(`- \`${group.key}\` count ${group.count}: ${group.names.join(" | ")} (${group.files.join(", ")}) - ${classificationLabel(group.classification)}; ${group.reason}`);
  }
  lines.push("");
}

function groupSummary(group, reason) {
  const names = [...group.resolvedNames.values()].flatMap((values) => [...values]);
  return {
    key: group.key,
    type: group.type,
    id: group.id,
    dropQuality: group.dropQuality,
    count: group.count,
    files: [...group.files].sort(),
    labels: [...group.labels].sort(),
    names: names.length ? names.sort() : [...group.labels].sort(),
    classification: primaryClassification(group),
    reason,
  };
}

function suggestedLookupLine(group, resolvedName) {
  const localizationPrefix = STACK_TYPES.has(group.type) ? "stack" : "research";
  const localizationId = `${localizationPrefix}_${slugName(resolvedName)}_${group.type}_${group.id}_${group.dropQuality}`;
  return `{ localizationId: "${localizationId}", name: "${escapeTsString(resolvedName)}", gameId: ${group.id}, type: ${group.type}, weaponType: 0 },`;
}

function invalidEntryReason(entry) {
  if (!Number.isFinite(entry.type) || entry.type < 0) return "invalid type";
  if (!Number.isFinite(entry.id) || entry.id < 0) return "invalid id";
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
  return left.type - right.type || left.id - right.id || left.dropQuality - right.dropQuality || left.key.localeCompare(right.key);
}

function groupKey(entry) {
  return `${entry.type}:${entry.id}:${entry.dropQuality}`;
}

function typeIdKey(type, id) {
  return `${type}:${id}`;
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
