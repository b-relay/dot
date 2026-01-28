import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupFile, loadBackupManifest, saveBackupManifest, type BackupManifest } from "../src/lib/backup";

describe("backup module", () => {
  let tempDir: string;
  let testFile: string;
  let backupDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    // Create temp directory for test isolation
    tempDir = await mkdtemp(join(tmpdir(), "backup-test-"));
    testFile = join(tempDir, "test.txt");
    backupDir = join(tempDir, "backups");
    manifestPath = join(backupDir, ".backup-manifest.json");

    // Create test file
    await writeFile(testFile, "test content");
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  test("backupFile creates backup with correct timestamp format", async () => {
    const manifest: BackupManifest = { backups: [] };

    const backupPath = await backupFile(testFile, backupDir, manifest);

    // Check that backup path contains timestamp in filesystem-safe format
    expect(backupPath).toMatch(/test\.txt\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.backup$/);

    // Check manifest was updated
    expect(manifest.backups).toHaveLength(1);
    expect(manifest.backups[0]?.original).toBe(testFile);
    expect(manifest.backups[0]?.backup).toBe(backupPath);
    expect(manifest.backups[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("backupFile creates backup directory if it doesn't exist", async () => {
    const manifest: BackupManifest = { backups: [] };

    // backupDir doesn't exist yet
    const backupPath = await backupFile(testFile, backupDir, manifest);

    // Backup should have been created successfully
    expect(backupPath).toContain(backupDir);

    // Verify backup file exists
    const backupContent = await Bun.file(backupPath).text();
    expect(backupContent).toBe("test content");
  });

  test("backupFile preserves file contents in backup", async () => {
    const content = "important data\nwith multiple lines\nand special chars: @#$%";
    await writeFile(testFile, content);

    const manifest: BackupManifest = { backups: [] };
    const backupPath = await backupFile(testFile, backupDir, manifest);

    const backupContent = await Bun.file(backupPath).text();
    expect(backupContent).toBe(content);
  });

  test("loadBackupManifest returns empty manifest if file doesn't exist", async () => {
    const manifest = await loadBackupManifest(manifestPath);

    expect(manifest).toEqual({ backups: [] });
  });

  test("loadBackupManifest loads existing manifest", async () => {
    const testManifest: BackupManifest = {
      backups: [
        {
          original: "/path/to/file1.txt",
          backup: "/backups/file1.txt.2026-01-27T12-00-00-000Z.backup",
          timestamp: "2026-01-27T12:00:00.000Z",
        },
        {
          original: "/path/to/file2.txt",
          backup: "/backups/file2.txt.2026-01-27T13-00-00-000Z.backup",
          timestamp: "2026-01-27T13:00:00.000Z",
        },
      ],
    };

    // Save test manifest
    await saveBackupManifest(manifestPath, testManifest);

    // Load it back
    const loaded = await loadBackupManifest(manifestPath);

    expect(loaded).toEqual(testManifest);
  });

  test("saveBackupManifest and loadBackupManifest roundtrip works", async () => {
    const originalManifest: BackupManifest = {
      backups: [
        {
          original: testFile,
          backup: join(backupDir, "test.txt.2026-01-27T12-00-00-000Z.backup"),
          timestamp: "2026-01-27T12:00:00.000Z",
        },
      ],
    };

    // Save
    await saveBackupManifest(manifestPath, originalManifest);

    // Load
    const loaded = await loadBackupManifest(manifestPath);

    // Should match
    expect(loaded).toEqual(originalManifest);
  });

  test("multiple backups of same file are tracked separately", async () => {
    const manifest: BackupManifest = { backups: [] };

    // First backup
    await backupFile(testFile, backupDir, manifest);
    expect(manifest.backups).toHaveLength(1);

    // Wait a tiny bit to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 5));

    // Second backup
    await backupFile(testFile, backupDir, manifest);
    expect(manifest.backups).toHaveLength(2);

    // Both should be tracked with different timestamps
    const [first, second] = manifest.backups;
    expect(first?.original).toBe(testFile);
    expect(second?.original).toBe(testFile);
    expect(first?.timestamp).not.toBe(second?.timestamp);
  });

  test("backupFile handles files with multiple extensions", async () => {
    const complexFile = join(tempDir, "config.backup.json");
    await writeFile(complexFile, "{}");

    const manifest: BackupManifest = { backups: [] };
    const backupPath = await backupFile(complexFile, backupDir, manifest);

    // Should preserve full filename
    expect(backupPath).toContain("config.backup.json");
    expect(backupPath).toMatch(/config\.backup\.json\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.backup$/);
  });

  test("saveBackupManifest creates parent directory if needed", async () => {
    const deepPath = join(tempDir, "deep", "nested", "path", ".backup-manifest.json");
    const manifest: BackupManifest = { backups: [] };

    // Should not throw, should create directory structure
    await saveBackupManifest(deepPath, manifest);

    // Verify it was written
    const loaded = await loadBackupManifest(deepPath);
    expect(loaded).toEqual(manifest);
  });

  test("loadBackupManifest handles corrupted JSON gracefully", async () => {
    // Ensure backup directory exists
    await mkdir(backupDir, { recursive: true });

    // Write invalid JSON
    await writeFile(manifestPath, "{ invalid json }");

    // Should return empty manifest instead of throwing
    const manifest = await loadBackupManifest(manifestPath);
    expect(manifest).toEqual({ backups: [] });
  });
});
