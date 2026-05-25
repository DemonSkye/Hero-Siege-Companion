import https from "node:https";
import type { ReleaseUpdateInfo } from "../shared/app-state";

const GITHUB_RELEASES_URL = "https://github.com/DemonSkye/Hero-Siege-Companion/releases";
const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/DemonSkye/Hero-Siege-Companion/releases/latest";
const RELEASE_CHECK_TIMEOUT_MS = 6000;

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
}

export async function checkForReleaseUpdate(currentAppVersion: string, onError: (error: Error) => void): Promise<ReleaseUpdateInfo | null> {
  const currentVersion = normalizeReleaseVersion(currentAppVersion);
  try {
    const release = await fetchLatestRelease(currentVersion);
    const version = normalizeReleaseVersion(release.tag_name || release.name || "");
    if (!version || !isNewerVersion(version, currentVersion)) return null;

    return {
      version,
      currentVersion,
      name: release.name || `Release ${version}`,
      url: release.html_url || `${GITHUB_RELEASES_URL}/tag/v${version}`,
      publishedAt: release.published_at || "",
    };
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

function fetchLatestRelease(currentVersion: string): Promise<GitHubReleasePayload> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      GITHUB_LATEST_RELEASE_API_URL,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Hero-Siege-Companion/${currentVersion}`,
        },
        timeout: RELEASE_CHECK_TIMEOUT_MS,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
            reject(new Error(`GitHub release check returned HTTP ${response.statusCode ?? "unknown"}.`));
            return;
          }

          try {
            resolve(JSON.parse(body) as GitHubReleasePayload);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("GitHub release check timed out."));
    });
    request.on("error", reject);
  });
}

function normalizeReleaseVersion(value: string): string {
  const match = value.trim().match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? "";
}

function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseVersionParts(candidate);
  const currentParts = parseVersionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] > currentParts[index]) return true;
    if (candidateParts[index] < currentParts[index]) return false;
  }
  return false;
}

function parseVersionParts(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(/[+-]/)[0].split(".");
  return [major, minor, patch].map((part) => Number.parseInt(part, 10) || 0) as [number, number, number];
}
