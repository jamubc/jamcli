import fs from 'fs';
import path from 'path';
import { configJsonSchema } from './schema.js';

/** The generated schema as it is checked in, so editors can complete configuration files. */
export const SCHEMA_FILE = path.join('docs', 'config.schema.json');

export const renderConfigSchema = (): string => `${JSON.stringify(configJsonSchema(), null, 2)}\n`;

// `bun run config-schema` regenerates the file after a schema change.
if (import.meta.main) {
  fs.writeFileSync(SCHEMA_FILE, renderConfigSchema());
  process.stdout.write(`Wrote ${SCHEMA_FILE}\n`);
}
