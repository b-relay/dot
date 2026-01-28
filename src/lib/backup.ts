import { mkdir, copyFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { getLogger } from "./logger.js";

const logger = getLogger(["backup"]);

export type BackupEntry = {
  original: string;    // Original file path
  backup: string;      // Backup file path
  timestamp: string;   // ISO timestamp when backed up
};

export type BackupManifest = {
  backups: BackupEntry[];
};

// Convert ISO timestamp to filesystem-safe format
// 2026-01-27T14:30:45.123Z -> 2026-01-27T14-30-45-123Z
function toFilesystemTimestamp(isoTimestamp: string): string {
  return isoTimestamp
    .replace(/:/g, "-")
    .replace(/\./g, "-");
}

/**
 * Back up a file with a timestamp in the filename.
 * Creates backup directory if it doesn't exist.
 * Adds entry to manifest.
 *
 * @param filePath - Path to file to back up
 * @param backupDir - Directory to store backup in
 * @param manifest - Backup manifest to update
 * @returns Path to the created backup file
 */
export async function backupFile(
  filePath: string,
  backupDir: string,
  manifest: BackupManifest
): Promise<string> {
  // Create backup directory if needed
  await mkdir(backupDir, { recursive: true });

  // Generate timestamp and backup filename
  const timestamp = new Date().toISOString();
  const fsTimestamp = toFilesystemTimestamp(timestamp);
  const filename = basename(filePath);
  const backupPath = `${backupDir}/${filename}.${fsTimestamp}.backup`;

  // Copy file to backup location
  await copyFile(filePath, backupPath);

  // Add entry to manifest
  manifest.backups.push({
    original: filePath,
    backup: backupPath,
    timestamp,
  });

  logger.info("Backed up file", {
    original: filePath,
    backup: backupPath,
    timestamp,
  });

  return backupPath;
}

/**
 * Load backup manifest from disk.
 * Returns empty manifest if file doesn't exist.
 *
 * @param manifestPath - Path to manifest file
 * @returns Backup manifest
 */
export async function loadBackupManifest(manifestPath: string): Promise<BackupManifest> {
  try {
    const content = await Bun.file(manifestPath).text();
    return JSON.parse(content);
  } catch (error) {
    // File doesn't exist or parse error - return empty manifest
    return { backups: [] };
  }
}

/**
 * Save backup manifest to disk atomically.
 *
 * @param manifestPath - Path to manifest file
 * @param manifest - Backup manifest to save
 */
export async function saveBackupManifest(
  manifestPath: string,
  manifest: BackupManifest
): Promise<void> {
  // Ensure parent directory exists
  await mkdir(dirname(manifestPath), { recursive: true });

  // Write atomically using write-file-atomic
  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}
