import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// Resolve __dirname safely in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function safeResolve(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

export const reviewSettings = {
  requireReviewForCommands: true,
  requireReviewForWrites: true,
};

export function getDescription(filename: string, fallback: string): string {
  try {
    const textPath = path.resolve(__dirname, filename);
    if (fs.existsSync(textPath)) {
      return fs.readFileSync(textPath, 'utf8').trim();
    }
    // Fallback search relative to cwd (development / workspace dev running)
    const srcPath = path.resolve(process.cwd(), 'src/tools', filename);
    if (fs.existsSync(srcPath)) {
      return fs.readFileSync(srcPath, 'utf8').trim();
    }
    const relativeSrcPath = path.resolve(process.cwd(), 'packages/aurora-agent/src/tools', filename);
    if (fs.existsSync(relativeSrcPath)) {
      return fs.readFileSync(relativeSrcPath, 'utf8').trim();
    }
  } catch (err) {
    // ignore
  }
  return fallback;
}
