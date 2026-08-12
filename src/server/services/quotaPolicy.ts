export type QuotaState = 'unlimited' | 'ok' | 'warning' | 'exceeded';

export interface QuotaEvaluation {
  state: QuotaState;
  ratio: number | null;
}

// Measurement-only phase: this function reports state; callers MUST NOT use it to block yet.
export function evaluateQuota(used: number, limit: number | null | undefined): QuotaEvaluation {
  if (limit == null) return { state: 'unlimited', ratio: null };
  if (!Number.isFinite(limit) || limit <= 0) return { state: 'exceeded', ratio: 1 };
  const ratio = Math.max(0, used) / limit;
  if (ratio >= 1) return { state: 'exceeded', ratio };
  if (ratio >= 0.8) return { state: 'warning', ratio };
  return { state: 'ok', ratio };
}
