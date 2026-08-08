import dotenv from 'dotenv';
import {
  DatabaseBootstrapError,
  ensurePostgresDatabases,
} from '../services/databaseBootstrap.js';

dotenv.config();

async function main(): Promise<void> {
  try {
    const results = await ensurePostgresDatabases(process.env);
    for (const result of results) {
      const action = result.created ? 'created' : 'already exists';
      console.log(`[db:ensure] ${result.envName}: ${result.databaseName} ${action}`);
    }
  } catch (error) {
    if (error instanceof DatabaseBootstrapError) {
      const databaseCode = error.databaseCode ? ` (PostgreSQL ${error.databaseCode})` : '';
      console.error(`[db:ensure] ${error.message}${databaseCode}`);
    } else {
      console.error('[db:ensure] Database bootstrap failed without exposing connection details.');
    }
    process.exitCode = 1;
  }
}

void main();
