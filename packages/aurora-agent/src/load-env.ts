import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

const result = dotenv.config({ path: envPath });

// Override empty environment variables with parsed values
if (result.parsed) {
  for (const k of Object.keys(result.parsed)) {
    if (!process.env[k] || process.env[k].trim() === '') {
      process.env[k] = result.parsed[k];
    }
  }
}
