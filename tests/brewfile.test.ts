import { describe, test, expect } from "bun:test";
import {
  parseBrewfile,
  getInstalledPackages,
  checkBrewfileSync,
  createConfig,
  type BrewfilePackage,
  type Config,
} from "../index";

describe("parseBrewfile", () => {
  // Create a test config pointing to the real dotfiles
  const config = createConfig();

  test("parses standard brew formula lines", async () => {
    const packages = await parseBrewfile(config);

    // Should find some common formulae from our brewfile
    const formulae = packages.filter(p => p.type === 'formula');
    expect(formulae.length).toBeGreaterThan(0);

    // Check for known packages in our brewfile
    const formulaNames = formulae.map(p => p.name);
    expect(formulaNames).toContain("fnm");
    expect(formulaNames).toContain("starship");
    expect(formulaNames).toContain("fzf");
  });

  test("parses cask lines with type='cask'", async () => {
    const packages = await parseBrewfile(config);

    // Should find casks
    const casks = packages.filter(p => p.type === 'cask');
    expect(casks.length).toBeGreaterThan(0);

    // All casks should have type='cask'
    for (const cask of casks) {
      expect(cask.type).toBe('cask');
    }
  });

  test("parses tap path formulae correctly", async () => {
    const packages = await parseBrewfile(config);

    // Our brewfile has oven-sh/bun/bun
    const bunPackage = packages.find(p => p.name === "oven-sh/bun/bun");
    expect(bunPackage).toBeDefined();
    expect(bunPackage!.type).toBe('formula');
  });

  test("extracts description from comment on previous line", async () => {
    const packages = await parseBrewfile(config);

    // Most packages in our brewfile have descriptions
    const withDescriptions = packages.filter(p => p.description);
    expect(withDescriptions.length).toBeGreaterThan(0);

    // Check a known package with description
    const fnm = packages.find(p => p.name === "fnm");
    expect(fnm).toBeDefined();
    expect(fnm!.description).toBeTruthy();
    expect(fnm!.description).toContain("Node");
  });

  test("ignores tap lines (not packages)", async () => {
    const packages = await parseBrewfile(config);

    // Tap lines should not be included as packages
    const tapPackage = packages.find(p => p.name.includes("homebrew/bundle"));
    expect(tapPackage).toBeUndefined();
  });
});

describe("getInstalledPackages", () => {
  test("returns BrewfilePackage[] with correct types", async () => {
    const packages = await getInstalledPackages();

    expect(Array.isArray(packages)).toBe(true);
    expect(packages.length).toBeGreaterThan(0);

    // Each package should have name and type
    for (const pkg of packages) {
      expect(pkg.name).toBeTruthy();
      expect(['formula', 'cask']).toContain(pkg.type);
    }
  });

  test("includes both formulae and casks", async () => {
    const packages = await getInstalledPackages();

    const formulae = packages.filter(p => p.type === 'formula');
    const casks = packages.filter(p => p.type === 'cask');

    // Should have at least some formulae installed
    expect(formulae.length).toBeGreaterThan(0);

    // Casks might be empty on some systems, but the array should exist
    expect(Array.isArray(casks)).toBe(true);
  });

  test("uses real brew commands (integration test)", async () => {
    const packages = await getInstalledPackages();

    // brew should be installed and return packages
    const formulaNames = packages
      .filter(p => p.type === 'formula')
      .map(p => p.name);

    // These are commonly installed on macOS dev machines
    // At minimum we should have something
    expect(formulaNames.length).toBeGreaterThan(5);
  });
});

describe("checkBrewfileSync", () => {
  const config = createConfig();

  test("returns BrewfileSyncStatus with both arrays", async () => {
    const status = await checkBrewfileSync(config);

    expect(status).toHaveProperty('inBrewfileNotInstalled');
    expect(status).toHaveProperty('installedNotInBrewfile');
    expect(Array.isArray(status.inBrewfileNotInstalled)).toBe(true);
    expect(Array.isArray(status.installedNotInBrewfile)).toBe(true);
  });

  test("tap path matching works (e.g., oven-sh/bun/bun matches installed bun)", async () => {
    const status = await checkBrewfileSync(config);

    // If bun is installed, it shouldn't appear in inBrewfileNotInstalled
    // because oven-sh/bun/bun in brewfile should match installed 'bun'
    const bunInBrewfileNotInstalled = status.inBrewfileNotInstalled.find(
      p => p.name.includes("bun")
    );

    // Either bun is installed (so it's not in the missing list)
    // or bun is not installed (so it would be in the list)
    // This test verifies the tap path matching logic works
    if (bunInBrewfileNotInstalled) {
      // bun is not installed
      expect(bunInBrewfileNotInstalled.name).toBe("oven-sh/bun/bun");
    } else {
      // bun is installed - verify it's not showing as untracked
      const bunUntracked = status.installedNotInBrewfile.find(
        p => p.name === "bun"
      );
      expect(bunUntracked).toBeUndefined();
    }
  });

  test("identifies installed packages not in brewfile", async () => {
    const status = await checkBrewfileSync(config);

    // There are usually some dependency packages not explicitly in brewfile
    // (transitive dependencies from brew install)
    const untrackedFormulae = status.installedNotInBrewfile.filter(
      p => p.type === 'formula'
    );

    // Most systems have some untracked dependencies
    // Just verify the structure is correct
    for (const pkg of untrackedFormulae) {
      expect(pkg.name).toBeTruthy();
      expect(pkg.type).toBe('formula');
    }
  });

  test("packages array items have correct shape", async () => {
    const status = await checkBrewfileSync(config);

    for (const pkg of status.inBrewfileNotInstalled) {
      expect(pkg.name).toBeTruthy();
      expect(['formula', 'cask']).toContain(pkg.type);
    }

    for (const pkg of status.installedNotInBrewfile) {
      expect(pkg.name).toBeTruthy();
      expect(['formula', 'cask']).toContain(pkg.type);
    }
  });
});
