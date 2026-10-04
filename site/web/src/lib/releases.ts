// Latest-release lookup for the download page.
//
// Supabase remains the preferred feed. GitHub's exact asset metadata is the
// fallback, so the page never combines one release version with another
// release's filename.

import { AURORA_API_URL } from "./appConfig";

const GITHUB_API_URL =
  "https://api.github.com/repos/TheShiveshNetwork/aurora-term/releases/latest";

export type PlatformKey = "windows" | "macos" | "linux";
export type CpuKey = "x64" | "arm64";

export type PackageSource = "supabase" | "github";

export interface ReleasePackage {
  name: string;
  platform: PlatformKey;
  cpu: CpuKey;
  size: number;
  url: string;
  source: PackageSource;
  fallbackUrl?: string;
  // Position within its target's `formats` list; 0 is the preferred installer.
  rank: number;
}

export interface LatestRelease {
  version: string | null;
  packages: ReleasePackage[];
}

interface InstallerTarget {
  platform: PlatformKey;
  cpu: CpuKey;
  formats: RegExp[];
}

// Installer formats per target, most preferred first. `.msi` is deliberately
// absent: the site only offers the NSIS `.exe` on Windows.
const INSTALLER_TARGETS: InstallerTarget[] = [
  { platform: "windows", cpu: "x64", formats: [/-setup\.exe$/i] },
  { platform: "macos", cpu: "arm64", formats: [/_aarch64\.dmg$/i, /_aarch64\.app\.tar\.gz$/i] },
  { platform: "macos", cpu: "x64", formats: [/_x64\.dmg$/i, /_x64\.app\.tar\.gz$/i] },
  { platform: "linux", cpu: "x64", formats: [/_amd64\.AppImage$/i, /_amd64\.deb$/i, /x86_64\.rpm$/i] },
  { platform: "linux", cpu: "arm64", formats: [/_arm64\.AppImage$/i, /_arm64\.deb$/i, /_aarch64\.rpm$/i] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Which installer target a published asset filename belongs to, and where it
// sits in that target's preference list. `null` for anything the site does not
// offer (MSI, source archives, LSP bundles).
export function classifyInstaller(
  name: string,
): { platform: PlatformKey; cpu: CpuKey; rank: number } | null {
  for (const target of INSTALLER_TARGETS) {
    const rank = target.formats.findIndex((format) => format.test(name));
    if (rank !== -1) return { platform: target.platform, cpu: target.cpu, rank };
  }
  return null;
}

function packageSource(url: string): PackageSource {
  try {
    const parsed = new URL(url);
    const expectedPrefix = `${new URL(AURORA_API_URL).origin}/storage/v1/object/public/`;
    if (
      url.startsWith(expectedPrefix) ||
      (parsed.hostname.endsWith(".supabase.co") &&
        parsed.pathname.startsWith("/storage/v1/object/public/"))
    ) {
      return "supabase";
    }
  } catch {
    // Fall through to the GitHub fallback below.
  }
  return "github";
}

function readReleasePackage(
  name: unknown,
  url: unknown,
  size: unknown,
): ReleasePackage | null {
  if (typeof name !== "string" || typeof url !== "string") return null;
  const target = classifyInstaller(name);
  if (!target) return null;
  const parsedSize = Number(size);
  return {
    name,
    ...target,
    size: Number.isFinite(parsedSize) ? parsedSize : 0,
    url,
    source: packageSource(url),
  };
}

function readSupabasePackage(value: unknown): ReleasePackage | null {
  if (!isRecord(value)) return null;
  return readReleasePackage(value.name, value.url, value.size);
}

function readGitHubPackage(value: unknown): ReleasePackage | null {
  if (!isRecord(value)) return null;
  return readReleasePackage(value.name, value.browser_download_url, value.size);
}

function parsePackages(
  value: unknown,
  readPackage: (entry: unknown) => ReleasePackage | null,
): ReleasePackage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(readPackage)
    .filter((entry): entry is ReleasePackage => entry !== null);
}

function parseSupabaseRelease(body: unknown): LatestRelease | null {
  if (!isRecord(body)) return null;
  return {
    version: typeof body.version === "string" ? body.version : null,
    packages: parsePackages(body.packages, readSupabasePackage),
  };
}

function parseGitHubRelease(body: unknown): LatestRelease | null {
  if (!isRecord(body)) return null;
  const { tag_name: tagName, assets } = body;
  if (typeof tagName !== "string") return null;
  if (body.draft === true || body.prerelease === true) return null;
  return {
    version: tagName.startsWith("v") ? tagName.slice(1) : tagName,
    packages: parsePackages(assets, readGitHubPackage),
  };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      console.warn(`releases: request failed with status ${response.status} for ${url}`);
      return null;
    }
    const body: unknown = await response.json();
    return body;
  } catch (error) {
    if (!signal?.aborted) console.warn(`releases: request failed for ${url}`, error);
    return null;
  }
}

async function fetchSupabaseRelease(signal?: AbortSignal): Promise<LatestRelease | null> {
  const body = await fetchJson(`${AURORA_API_URL}/v1/update/latest`, signal);
  return parseSupabaseRelease(body);
}

async function fetchGitHubRelease(signal?: AbortSignal): Promise<LatestRelease | null> {
  const body = await fetchJson(GITHUB_API_URL, signal);
  return parseGitHubRelease(body);
}

function releaseVersionParts(version: string | null): [number, number, number] | null {
  if (!version) return null;
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerRelease(candidate: string | null, current: string | null): boolean {
  const candidateParts = releaseVersionParts(candidate);
  const currentParts = releaseVersionParts(current);
  if (!candidateParts) return false;
  if (!currentParts) return true;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

function mergeReleases(
  primary: LatestRelease | null,
  secondary: LatestRelease | null,
): LatestRelease | null {
  if (!primary) return secondary;
  if (!secondary) return primary;
  if (primary.version !== secondary.version) {
    return isNewerRelease(secondary.version, primary.version) ? secondary : primary;
  }
  const secondaryByName = new Map(secondary.packages.map((entry) => [entry.name, entry]));
  const packages = primary.packages.map((entry) => {
    const fallback = secondaryByName.get(entry.name);
    if (fallback && fallback.url !== entry.url) return { ...entry, fallbackUrl: fallback.url };
    return entry;
  });
  for (const entry of secondary.packages) {
    if (!packages.some((existing) => existing.name === entry.name)) packages.push(entry);
  }
  return {
    version: primary.version ?? secondary.version,
    packages,
  };
}

async function isSupabaseUrlAvailable(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    // A HEAD request checks the object without downloading a large installer.
    // A CORS/network failure is treated the same as a missing object: the
    // caller then uses the exact GitHub asset URL.
    const timeout = AbortSignal.timeout(10000);
    const response = await fetch(url, {
      method: "HEAD",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function verifySupabasePackages(
  release: LatestRelease | null,
  signal?: AbortSignal,
): Promise<LatestRelease | null> {
  if (!release) return null;
  const packages = await Promise.all(
    release.packages.map(async (entry) => {
      if (entry.source !== "supabase") return entry;
      if (await isSupabaseUrlAvailable(entry.url, signal)) return entry;
      if (entry.fallbackUrl) return { ...entry, url: entry.fallbackUrl, source: "github" };
      return null;
    }),
  );
  return {
    ...release,
    packages: packages.filter((entry): entry is ReleasePackage => entry !== null),
  };
}

export async function fetchLatestRelease(
  signal?: AbortSignal,
): Promise<LatestRelease | null> {
  const [supabaseRelease, githubRelease] = await Promise.all([
    fetchSupabaseRelease(signal),
    fetchGitHubRelease(signal),
  ]);
  return verifySupabasePackages(mergeReleases(supabaseRelease, githubRelease), signal);
}

export function installersFor(
  release: LatestRelease,
  platform: PlatformKey,
): ReleasePackage[] {
  return release.packages
    .filter((entry) => entry.platform === platform)
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
}

// Preferred installer for a target, falling back to whatever else that platform
// and CPU shipped (arm64 Linux has no AppImage, only a .deb).
export function installerUrl(
  release: LatestRelease,
  platform: PlatformKey,
  cpu: CpuKey,
): string | null {
  const match = installersFor(release, platform).find((entry) => entry.cpu === cpu);
  return match ? match.url : null;
}

export function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${megabytes.toFixed(1)} MB`;
}