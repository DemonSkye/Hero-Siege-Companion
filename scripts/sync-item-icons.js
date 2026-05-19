const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const RARITY_PATH = path.join(ROOT, "src", "shared", "item-rarity.ts");
const ICON_DIR = path.join(ROOT, "img", "items");
const MANIFEST_PATH = path.join(ROOT, "src", "shared", "item-icons.ts");
const REPORT_MD_PATH = path.join(ROOT, "docs", "item-icon-missing-report.md");
const REPORT_JSON_PATH = path.join(ROOT, "docs", "item-icon-missing-report.json");
const WIKI_API = "https://herosiege.fandom.com/api.php";
const ITEM_DATABASE_URL = "https://herosiege.net/wiki/Items";
const TARGET_RARITIES = ["Set", "Satanic", "Heroic", "Angelic", "Unholy"];
const TARGET_RARITY_SET = new Set(TARGET_RARITIES);
const USER_AGENT = "HeroSiegeCompanion/0.0.3 (item icon sync)";

async function main() {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REPORT_MD_PATH), { recursive: true });

  const localTargets = readLocalTargetItems();
  const wikiItems = Object.values(await fetchItemDatabase());
  const wikiIndex = buildWikiIndex(wikiItems);
  const selected = new Map();
  const localResolution = new Map();
  const matchReport = [];
  const missingWikiItems = [];

  for (const [name, rarity] of localTargets) {
    const match = findWikiItemMatch(name, rarity, wikiIndex);
    if (!match) {
      missingWikiItems.push({ name, rarity });
      continue;
    }

    selected.set(name, {
      name,
      displayName: match.item.title,
      rarity,
      image: match.item.image,
      matchedName: match.item.name,
      matchMethod: match.method,
      score: match.score,
    });
    localResolution.set(name, match.method);
    if (match.method !== "exact") {
      matchReport.push({
        name,
        rarity,
        matchedName: match.item.name,
        method: match.method,
        score: match.score,
        image: match.item.image,
      });
    }
  }

  const allImages = await fetchAllImages();
  const allImagesByFile = new Map(allImages.map((image) => [normalizeFileName(image.name), image]));

  for (const item of missingWikiItems) {
    const match = findImageFileMatch(item.name, allImages);
    if (!match) continue;

    selected.set(item.name, {
      name: item.name,
      displayName: displayItemName(item.name),
      rarity: item.rarity,
      image: match.image.name,
      imageInfo: match.image,
      matchedName: stripImageExtension(match.image.name),
      matchMethod: `image-${match.method}`,
      score: match.score,
    });
    localResolution.set(item.name, `image-${match.method}`);
    matchReport.push({
      name: item.name,
      rarity: item.rarity,
      matchedName: stripImageExtension(match.image.name),
      method: `image-${match.method}`,
      score: match.score,
      image: match.image.name,
    });
  }

  for (const item of wikiIndex.items) {
    if (!TARGET_RARITY_SET.has(item.rarity) || selected.has(item.name) || localTargets.has(item.name)) continue;
    selected.set(item.name, {
      name: item.name,
      displayName: item.title,
      rarity: item.rarity,
      image: item.image,
      matchedName: item.name,
      matchMethod: "wiki-extra",
    });
  }

  const imageInfos = await fetchImageInfos(Array.from(new Set(Array.from(selected.values()).map((item) => item.image))));
  const manifest = {};
  const unresolvedImages = [];

  for (const item of selected.values()) {
    const imageInfo = item.imageInfo ?? imageInfos.get(normalizeFileName(item.image)) ?? allImagesByFile.get(normalizeFileName(item.image));
    if (!imageInfo?.url) {
      unresolvedImages.push(item);
      continue;
    }

    const fileName = `${slugify(item.displayName)}${extensionFromUrl(imageInfo.url)}`;
    await downloadFile(imageInfo.url, path.join(ICON_DIR, fileName));
    manifest[item.name] = fileName;
  }

  writeManifest(manifest);
  writeReport({
    localTargets,
    manifest,
    localResolution,
    matchReport,
    unresolvedImages,
    wikiItemCount: wikiIndex.items.length,
    wikiImageCount: allImages.length,
  });

  const localMissing = Array.from(localTargets.keys()).filter((name) => !manifest[name]);
  console.log("Item icon sync complete.");
  console.log(`Target icons: ${Object.keys(manifest).length}`);
  console.log(`Local target assets covered: ${localTargets.size - localMissing.length}/${localTargets.size}`);
  console.log(`Local target assets missing: ${localMissing.length}`);
  console.log(`Alias/wiki image matches used: ${matchReport.length}`);
  if (unresolvedImages.length) console.log(`Wiki image files not resolved: ${unresolvedImages.length}`);
  console.log(`Missing report: ${REPORT_MD_PATH}`);
}

function readLocalTargetItems() {
  const source = fs.readFileSync(RARITY_PATH, "utf8");
  const targets = new Map();
  const entryPattern = /"([^"]+)":\s*"(Set|Satanic|Heroic|Angelic|Unholy)"/g;
  let match;
  while ((match = entryPattern.exec(source))) {
    targets.set(normalizeItemName(match[1]), match[2]);
  }
  return targets;
}

async function fetchItemDatabase() {
  const html = await fetchText(ITEM_DATABASE_URL);
  const items = parseHeroSiegeNetItems(html);
  if (Object.keys(items).length > 0) return items;

  const url = `${WIKI_API}?action=query&prop=revisions&rvprop=content&titles=HerosiegeItems.json&format=json`;
  const response = JSON.parse(await fetchText(url));
  const page = Object.values(response.query?.pages ?? {})[0];
  const raw = page?.revisions?.[0]?.["*"];
  if (!raw) throw new Error("Wiki response did not include HerosiegeItems.json content.");
  return JSON.parse(raw);
}

function parseHeroSiegeNetItems(html) {
  const items = {};
  const pattern = /<span[^>]*id="JSON and clean JSON"[^>]*>\s*({[\s\S]*?})\s*<br><br>/g;
  let match;
  while ((match = pattern.exec(html))) {
    const rawJson = decodeHtml(match[1]).trim();
    try {
      const item = JSON.parse(rawJson);
      const title = cleanWikiLink(stringValue(item.title1));
      if (!title) continue;
      item.title1 = title;
      item.image1 = cleanWikiLink(stringValue(item.image1));
      item.rarity = cleanWikiLink(stringValue(item.rarity));
      items[slugify(title)] = item;
    } catch {
      // Individual wiki cards are best-effort. A bad card should not stop the icon sync.
    }
  }
  return items;
}

function buildWikiIndex(wikiItems) {
  const items = [];
  const exact = new Map();
  const loose = new Map();

  for (const item of wikiItems) {
    const title = stringValue(item.title1);
    const image = stringValue(item.image1);
    if (!title || !image) continue;

    const entry = {
      name: normalizeItemName(title),
      looseNames: normalizeLooseVariants(title),
      title,
      image,
      rarity: stringValue(item.rarity),
    };
    items.push(entry);
    exact.set(entry.name, entry);
    for (const looseName of entry.looseNames) {
      const matches = loose.get(looseName) ?? [];
      matches.push(entry);
      loose.set(looseName, matches);
    }
  }

  return { items, exact, loose };
}

function findWikiItemMatch(name, rarity, wikiIndex) {
  const exact = wikiIndex.exact.get(name);
  if (exact) return { item: exact, method: "exact", score: 1 };

  const looseMatches = filterByRarity(
    Array.from(new Set(normalizeLooseVariants(name).flatMap((looseName) => wikiIndex.loose.get(looseName) ?? []))),
    rarity,
  );
  if (looseMatches.length === 1) return { item: looseMatches[0], method: "loose", score: 0.99 };

  const rarityMatch = bestTextMatch(
    name,
    filterByRarity(wikiIndex.items, rarity),
    (item) => item.name,
    (item) => item.title.length <= 7 ? 0.95 : 0.9,
    "fuzzy",
  );
  if (rarityMatch) return rarityMatch;

  return bestTextMatch(
    name,
    wikiIndex.items,
    (item) => item.name,
    (item) => item.title.length <= 7 ? 0.98 : 0.94,
    "fuzzy-cross-rarity",
  );
}

function findImageFileMatch(name, images) {
  const exactKeys = new Set(normalizeLooseVariants(name));
  const exact = images.find((image) => normalizeLooseVariants(stripImageExtension(image.name)).some((key) => exactKeys.has(key)));
  if (exact) return { image: exact, method: "exact", score: 1 };

  const match = bestTextMatch(
    name,
    images,
    (image) => stripImageExtension(image.name),
    () => name.length <= 7 ? 0.96 : 0.92,
    "fuzzy",
  );
  return match ? { image: match.item, method: match.method, score: match.score } : null;
}

function bestTextMatch(sourceName, candidates, candidateName, thresholdForCandidate, method) {
  let best = null;
  let runnerUp = 0;

  for (const item of candidates) {
    const score = textSimilarity(sourceName, candidateName(item));
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { item, method, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best) return null;
  const threshold = thresholdForCandidate(best.item);
  if (best.score < threshold) return null;
  if (best.score < 0.97 && best.score - runnerUp < 0.04) return null;
  return best;
}

function filterByRarity(items, rarity) {
  const exact = items.filter((item) => item.rarity === rarity);
  return exact.length ? exact : items;
}

async function fetchAllImages() {
  const images = [];
  let continuation = "";

  do {
    const url = `${WIKI_API}?action=query&list=allimages&ailimit=500&aiprop=url&format=json${continuation}`;
    const response = JSON.parse(await fetchText(url));
    for (const image of response.query?.allimages ?? []) {
      if (!/\.(png|webp|jpe?g)$/i.test(image.name ?? "")) continue;
      images.push({ name: image.name, url: image.url });
    }
    continuation = response.continue?.aicontinue ? `&aicontinue=${encodeURIComponent(response.continue.aicontinue)}` : "";
  } while (continuation);

  return images;
}

async function fetchImageInfos(imageNames) {
  const infos = new Map();
  const batchSize = 40;
  for (let index = 0; index < imageNames.length; index += batchSize) {
    const batch = imageNames.slice(index, index + batchSize);
    const titles = batch.map((name) => `File:${name}`).join("|");
    const url = `${WIKI_API}?action=query&prop=imageinfo&iiprop=url&format=json&titles=${encodeURIComponent(titles)}`;
    const response = JSON.parse(await fetchText(url));
    for (const page of Object.values(response.query?.pages ?? {})) {
      const title = String(page.title ?? "").replace(/^File:/, "");
      infos.set(normalizeFileName(title), page.imageinfo?.[0] ?? null);
    }
  }
  return infos;
}

function writeManifest(manifest) {
  const entries = Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    "// Generated by scripts/sync-item-icons.js.",
    "// Keys are normalized item names; values are files in img/items.",
    "const ITEM_ICON_FILE_BY_NAME: Record<string, string> = {",
    ...entries.map(([name, file]) => `  ${JSON.stringify(name)}: ${JSON.stringify(file)},`),
    "};",
    "",
    "export function lookupItemIconFile(name: string | undefined): string | null {",
    "  if (!name) return null;",
    "  return ITEM_ICON_FILE_BY_NAME[normalizeItemIconName(name)] ?? null;",
    "}",
    "",
    "export function allItemIconNames(): string[] {",
    "  return Object.keys(ITEM_ICON_FILE_BY_NAME).map((name) =>",
    "    name.split(\" \").map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word).join(\" \"),",
    "  );",
    "}",
    "",
    "function normalizeItemIconName(name: string): string {",
    "  return name",
    "    .normalize(\"NFKD\")",
    "    .replace(/[\\u0300-\\u036f]/g, \"\")",
    "    .replace(/[\\u2018\\u2019`\\u00b4]/g, \"'\")",
    "    .replace(/[\\u201c\\u201d]/g, '\\\"')",
    "    .replace(/[\\u2010-\\u2015]/g, \"-\")",
    "    .replace(/\\s+/g, \" \")",
    "    .trim()",
    "    .toLowerCase();",
    "}",
    "",
  ];
  fs.writeFileSync(MANIFEST_PATH, lines.join("\n"), "utf8");
}

function writeReport({ localTargets, manifest, localResolution, matchReport, unresolvedImages, wikiItemCount, wikiImageCount }) {
  const missing = Array.from(localTargets.entries())
    .filter(([name]) => !manifest[name])
    .map(([name, rarity]) => ({ name, rarity }));
  const coverage = rarityCounts(localTargets, manifest);
  const report = {
    generatedAt: new Date().toISOString(),
    wikiItemCount,
    wikiImageCount,
    localTargetTotal: localTargets.size,
    manifestEntries: Object.keys(manifest).length,
    localCovered: localTargets.size - missing.length,
    localMissing: missing.length,
    coverage,
    resolutionMethods: countValues(Array.from(localResolution.values())),
    aliasMatches: matchReport,
    unresolvedImages: unresolvedImages.map((item) => ({
      name: item.name,
      rarity: item.rarity,
      displayName: item.displayName,
      image: item.image,
      method: item.matchMethod,
    })),
    missing,
  };

  fs.writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines = [
    "# Item Icon Missing Asset Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Local target items: ${report.localTargetTotal}`,
    `- Manifest entries: ${report.manifestEntries}`,
    `- Local target assets covered: ${report.localCovered}/${report.localTargetTotal}`,
    `- Local target assets missing: ${report.localMissing}`,
    `- Wiki item cards scanned: ${wikiItemCount}`,
    `- Wiki image files scanned: ${wikiImageCount}`,
    "",
    "## Coverage By Rarity",
    "",
    "| Rarity | Covered | Total | Missing |",
    "| --- | ---: | ---: | ---: |",
    ...TARGET_RARITIES.map((rarity) => {
      const row = coverage[rarity] ?? { covered: 0, total: 0, missing: 0 };
      return `| ${rarity} | ${row.covered} | ${row.total} | ${row.missing} |`;
    }),
    "",
    "## Resolution Methods",
    "",
    ...Object.entries(report.resolutionMethods)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([method, total]) => `- ${method}: ${total}`),
    "",
    "## Missing Local Assets",
    "",
    ...missingByRarityMarkdown(missing),
    "",
    "## Alias/Fuzzy Matches Used",
    "",
    ...matchReport
      .sort((a, b) => a.rarity.localeCompare(b.rarity) || a.name.localeCompare(b.name))
      .map((match) => `- ${match.rarity}: ${match.name} -> ${match.matchedName} (${match.method}, ${match.score.toFixed(3)})`),
    "",
    "## Referenced Wiki Images Still Unresolved",
    "",
    ...report.unresolvedImages.map((item) => `- ${item.rarity}: ${item.name} -> ${item.image} (${item.method})`),
    "",
  ];

  fs.writeFileSync(REPORT_MD_PATH, lines.join("\n"), "utf8");
}

function rarityCounts(localTargets, manifest) {
  const rows = {};
  for (const rarity of TARGET_RARITIES) rows[rarity] = { covered: 0, total: 0, missing: 0 };
  for (const [name, rarity] of localTargets) {
    rows[rarity].total += 1;
    if (manifest[name]) rows[rarity].covered += 1;
    else rows[rarity].missing += 1;
  }
  return rows;
}

function missingByRarityMarkdown(missing) {
  const lines = [];
  for (const rarity of TARGET_RARITIES) {
    const items = missing.filter((item) => item.rarity === rarity).sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`### ${rarity} (${items.length})`, "");
    if (!items.length) {
      lines.push("_None_", "");
      continue;
    }
    lines.push(...items.map((item) => `- ${item.name}`), "");
  }
  return lines;
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function stringValue(value) {
  return typeof value === "string" ? value.replace(/\[\[|\]\]/g, "").trim() : "";
}

function cleanWikiLink(value) {
  return stringValue(value)
    .replace(/^file:/i, "")
    .replace(/\|.*$/, "")
    .trim();
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeItemName(name) {
  return stringValue(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019`\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeLooseVariants(name) {
  const base = normalizeItemName(name)
    .replace(/&/g, "and")
    .replace(/\bthe\b/g, "");
  const variants = new Set();
  addLooseVariant(variants, base);
  addLooseVariant(variants, base.replace(/\b([a-z0-9]+)\s+s\b/g, "$1s").replace(/'s\b/g, "s").replace(/s'\b/g, "s"));
  addLooseVariant(variants, base.replace(/\b([a-z0-9]+)\s+s\b/g, "$1").replace(/'s\b/g, "").replace(/s'\b/g, "s"));
  addLooseVariant(variants, base.replace(/memento/g, "momento"));
  addLooseVariant(variants, base.replace(/momento/g, "memento"));
  addLooseVariant(variants, base.replace(/harbringer/g, "harbinger"));
  addLooseVariant(variants, base.replace(/dieties/g, "deities"));
  return Array.from(variants).filter(Boolean);
}

function addLooseVariant(variants, value) {
  variants.add(
    value
      .replace(/\b([a-z0-9]+)\s+s\b/g, "$1s")
      .replace(/[^a-z0-9]+/g, ""),
  );
}

function textSimilarity(left, right) {
  let score = tokenJaccard(left, right);
  for (const leftVariant of normalizeLooseVariants(left)) {
    for (const rightVariant of normalizeLooseVariants(right)) {
      if (!leftVariant || !rightVariant) continue;
      score = Math.max(score, diceCoefficient(leftVariant, rightVariant));
    }
  }
  return score;
}

function slugify(name) {
  return normalizeItemName(name)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extensionFromUrl(url) {
  const match = new URL(url).pathname.match(/\.(png|webp|jpg|jpeg)(?:\/|$)/i);
  return match ? `.${match[1].toLowerCase()}` : ".png";
}

function normalizeFileName(name) {
  return cleanWikiLink(name).replace(/_/g, " ").toLowerCase();
}

function stripImageExtension(fileName) {
  return cleanWikiLink(fileName).replace(/\.(png|webp|jpe?g)$/i, "");
}

function displayItemName(name) {
  return normalizeItemName(name)
    .split(" ")
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(" ");
}

function tokenJaccard(left, right) {
  const leftTokens = new Set(normalizeItemName(left).split(/[^a-z0-9]+/).filter(Boolean));
  const rightTokens = new Set(normalizeItemName(right).split(/[^a-z0-9]+/).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function diceCoefficient(left, right) {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftBigrams = bigramCounts(left);
  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const bigram = right.slice(index, index + 2);
    const count = leftBigrams.get(bigram) ?? 0;
    if (count > 0) {
      leftBigrams.set(bigram, count - 1);
      overlap += 1;
    }
  }
  return (2 * overlap) / (left.length + right.length - 2);
}

function bigramCounts(value) {
  const counts = new Map();
  for (let index = 0; index < value.length - 1; index += 1) {
    const bigram = value.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": USER_AGENT } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(fetchText(new URL(response.headers.location, url).toString()));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} failed with ${response.statusCode}`));
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.setTimeout(30_000, () => {
      request.destroy(new Error(`GET ${url} timed out`));
    });
  });
}

function downloadFile(url, destination) {
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": USER_AGENT } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} failed with ${response.statusCode}`));
        return;
      }
      const tempPath = `${destination}.tmp`;
      const output = fs.createWriteStream(tempPath);
      response.pipe(output);
      output.on("finish", () => {
        output.close(() => {
          fs.renameSync(tempPath, destination);
          resolve();
        });
      });
      output.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(30_000, () => {
      request.destroy(new Error(`GET ${url} timed out`));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
