import dotenv from 'dotenv';
import { initDatabase, closeDatabase } from '../db/postgres.js';
import {
  initControlPlaneDatabase,
  closeControlPlaneDatabase,
} from '../db/controlPlane.js';
import { initLogPlaneDatabase, closeLogPlaneDatabase } from '../db/logPlane.js';
import {
  DatabaseMigrationError,
  runDatabaseMigrations,
} from '../services/databaseMigration.js';

dotenv.config();

async function main(): Promise<void> {
  try {
    await runDatabaseMigrations([
      { plane: 'assessment', migrate: initDatabase, close: closeDatabase },
      { plane: 'control', migrate: initControlPlaneDatabase, close: closeControlPlaneDatabase },
      { plane: 'log', migrate: initLogPlaneDatabase, close: closeLogPlaneDatabase },
    ], (plane) => console.log(`[db:migrate] ${plane} plane migrated`));
    console.log('[db:migrate] All database planes migrated successfully');
  } catch (error) {
    if (error instanceof DatabaseMigrationError) {
      console.error(`[db:migrate] ${error.message}`);
    } else {
      console.error('[db:migrate] Database migration failed without exposing connection details.');
    }
    process.exitCode = 1;
  }
}

void main();
