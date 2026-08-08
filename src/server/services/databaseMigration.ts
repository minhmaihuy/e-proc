export type DatabasePlaneName = 'assessment' | 'control' | 'log';

export interface DatabaseMigrationStep {
  plane: DatabasePlaneName;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseMigrationResult {
  plane: DatabasePlaneName;
  migrated: true;
}

export class DatabaseMigrationError extends Error {
  constructor(
    public readonly code: 'MIGRATION_FAILED' | 'MIGRATION_CLEANUP_FAILED',
    public readonly plane: DatabasePlaneName,
  ) {
    super(
      code === 'MIGRATION_FAILED'
        ? `Migration failed for the ${plane} database plane.`
        : `Migration cleanup failed for the ${plane} database plane.`,
    );
    this.name = 'DatabaseMigrationError';
  }
}

export async function runDatabaseMigrations(
  steps: DatabaseMigrationStep[],
  onMigrated?: (plane: DatabasePlaneName) => void,
): Promise<DatabaseMigrationResult[]> {
  const results: DatabaseMigrationResult[] = [];
  let primaryError: DatabaseMigrationError | null = null;

  for (const step of steps) {
    try {
      await step.migrate();
      results.push({ plane: step.plane, migrated: true });
      onMigrated?.(step.plane);
    } catch {
      primaryError = new DatabaseMigrationError('MIGRATION_FAILED', step.plane);
      break;
    }
  }

  let cleanupError: DatabaseMigrationError | null = null;
  for (const step of [...steps].reverse()) {
    try {
      await step.close();
    } catch {
      cleanupError ||= new DatabaseMigrationError('MIGRATION_CLEANUP_FAILED', step.plane);
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return results;
}
