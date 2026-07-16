import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function getDirSize(dirPath: string): number {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      size += getDirSize(filePath);
    } else {
      size += stats.size;
    }
  }
  return size;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

console.log('--- Aurora Size Audit ---');

// 1. Audit Frontend Bundle
console.log('\nMeasuring frontend bundle size...');
const frontendDist = path.resolve(process.cwd(), 'app/dist');
if (fs.existsSync(frontendDist)) {
  const size = getDirSize(frontendDist);
  console.log(`Frontend dist size (app/dist): ${formatBytes(size)}`);
} else {
  console.log('Frontend dist folder not found. Run pnpm build first.');
}

// 2. Audit Backend Binaries
console.log('\nMeasuring backend binaries...');
const binaryPath = process.platform === 'win32'
  ? 'target/release/aurora-term.exe'
  : 'target/release/aurora-term';
const resolvedBinary = path.resolve(process.cwd(), binaryPath);

if (fs.existsSync(resolvedBinary)) {
  const stats = fs.statSync(resolvedBinary);
  console.log(`Backend binary (${binaryPath}): ${formatBytes(stats.size)}`);
} else {
  console.log(`Backend binary not found at ${binaryPath}. Run pnpm tauri build first.`);
}

// 3. Audit Sidecar Binary
console.log('\nMeasuring sidecar binary...');
const sidecarsDir = path.resolve(process.cwd(), 'tauri/binaries');
if (fs.existsSync(sidecarsDir)) {
  const files = fs.readdirSync(sidecarsDir);
  for (const file of files) {
    const stats = fs.statSync(path.join(sidecarsDir, file));
    console.log(`Sidecar binary (${file}): ${formatBytes(stats.size)}`);
  }
}

// 4. Audit Bundled Installers
console.log('\nMeasuring bundled installers...');
const bundleDir = path.resolve(process.cwd(), 'target/release/bundle');
if (fs.existsSync(bundleDir)) {
  const size = getDirSize(bundleDir);
  console.log(`Tauri bundles size (target/release/bundle): ${formatBytes(size)}`);
  
  const printBundles = (dir: string) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        printBundles(filePath);
      } else if (file.endsWith('.exe') || file.endsWith('.msi') || file.endsWith('.dmg') || file.endsWith('.deb') || file.endsWith('.appimage')) {
        console.log(`  - ${file}: ${formatBytes(stats.size)}`);
      }
    }
  };
  printBundles(bundleDir);
}

// 5. Cargo Bloat
console.log('\nRunning cargo bloat...');
try {
  const bloatOut = execSync('cargo bloat --release --workspace', { encoding: 'utf-8', stdio: 'pipe' });
  console.log(bloatOut);
} catch (error: any) {
  console.log('cargo-bloat is not installed or failed to run. Install it using "cargo install cargo-bloat".');
}
