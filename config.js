// Loads the optional .env file before anything reads process.env.
// Every other module imports this first, so the order of imports never matters.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));

// Real environment variables win over the .env file
try {
  process.loadEnvFile(path.join(here, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') { throw error; }
}
