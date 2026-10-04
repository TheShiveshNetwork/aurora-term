// Latest-release lookup for the download page.
//
// `aurora-api` owns the release feed: it caches one row per release family in
// the `release_cache` table and re-hosts installers in the public `aurora`
// Storage bucket. Every installer comes back with a working `url` — the Supabase
// object when it was mirrored, the GitHub asset when it exceeded the storage
// cap — so the page never has to guess a URL.

import { AURORA_API_URL } from "./appConfig";

export type PlatformKey = "windows" | "macos" | "linux";
export type CpuKey = "x64" | "arm64";

export interface ReleasePackage {
  name: string;
  platform: PlatformKey;
  cpu: CpuKey;
  size: number;
  url: string;
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

function readPackage(value: unknown): ReleasePackage | null {
  if (!isRecord(value)) return null;
  const { name, url } = value;
  if (typeof name !== "string" || typeof url !== "string") return null;
  const target = classifyInstaller(name);
  if (!target) return null;
  const size = Number(value.size);
  return {
    name,
    ...target,
    size: Number.isFinite(size) ? size : 0,
    url,
  };
}

export async function fetchLatestRelease(
  signal?: AbortSignal,
): Promise<LatestRelease | null> {
  try {
    const response = await fetch(`${AURORA_API_URL}/v1/update/latest`, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      console.warn(`releases: aurora-api responded ${response.status}`);
      return null;
    }
    const body: unknown = await response.json();
    if (!isRecord(body)) return null;
    return {
      version: typeof body.version === "string" ? body.version : null,
      packages: Array.isArray(body.packages)
        ? body.packages
            .map(readPackage)
            .filter((entry): entry is ReleasePackage => entry !== null)
        : [],
    };
  } catch (error) {
    if (!signal?.aborted) console.warn("releases: aurora-api unreachable", error);
    return null;
  }
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