import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

const beforeKey = process.env.GROQ_API_KEY;
const beforeExists = 'GROQ_API_KEY' in process.env;

const result = dotenv.config({ path: envPath });

// Override empty environment variables with parsed values
if (result.parsed) {
  for (const k of Object.keys(result.parsed)) {
    if (!process.env[k] || process.env[k].trim() === '') {
      process.env[k] = result.parsed[k];
    }
  }
}

const afterKey = process.env.GROQ_API_KEY;
const afterExists = 'GROQ_API_KEY' in process.env;

const logMsg = `[Aura Env] __dirname=${__dirname}\n` +
               `[Aura Env] Loading .env from: ${envPath}\n` +
               `[Aura Env] Before: exists=${beforeExists}, value="${beforeKey}"\n` +
               `[Aura Env] dotenv result: ${result.error ? result.error.message : 'success'}\n` +
               `[Aura Env] parsed keys: ${JSON.stringify(result.parsed)}\n` +
               `[Aura Env] After: exists=${afterExists}, value="${afterKey}"\n`;

fs.appendFileSync('d:/builds/aurora/sidecar_output.log', logMsg);
