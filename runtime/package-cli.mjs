import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageManager } from './package-manager.mjs';
import { ensureGitHubCLI } from './cli-bootstrap.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const prefix = process.env.PREFIX;
if (!prefix) { console.error('pi-pkg requires the Android app PREFIX.'); process.exit(1); }
const manager = createPackageManager({ prefix, stateDir: path.join(process.env.HOME, '.pi-mobile'), baselineFile: path.join(root, 'termux-packages.json') });
const [command, name, ...flags] = process.argv.slice(2);
try {
  if (command === 'list') {
    const packages = await manager.installed();
    for (const pkg of packages.values()) console.log(`${pkg.package}\t${pkg.version}\t${pkg.bundled ? 'bundled' : 'added'}`);
  } else if (['plan', 'install'].includes(command) && name) {
    const result = await manager.plan(name);
    if (!result.packages.length) console.log(`${name} is already installed.`);
    else for (const pkg of result.packages) console.log(`${pkg.Package}\t${pkg.Version}\t${pkg.Size} bytes`);
    if (command === 'install') {
      if (!flags.includes('--yes')) throw new Error('Approval required. Review this plan, then run pi-pkg install PACKAGE --yes after the user agrees.');
      await manager.install(name, console.log);
      await ensureGitHubCLI(prefix, process.env.HOME);
    }
  } else {
    throw new Error('Usage: pi-pkg list | pi-pkg plan PACKAGE | pi-pkg install PACKAGE --yes');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
