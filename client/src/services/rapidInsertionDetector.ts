export interface RapidInsertionMetadata {
  insertedChars: number;
  changeCount: number;
  windowMs: number;
  maxSingleChange: number;
}

interface Sample {
  at: number;
  chars: number;
}

const WINDOW_MS = 2500;
const THRESHOLD_CHARS = 300;
const SINGLE_CHANGE_LIMIT = 300;
const COOLDOWN_MS = 10000;

/**
 * Detects text arriving too quickly across multiple editor change callbacks.
 * Single changes of 300+ characters remain owned by CodeEditor's existing
 * suspicious-paste detector, so the two forensic signals do not double-report.
 */
export class RapidInsertionDetector {
  private samples: Sample[] = [];
  private lastFiredAt = 0;

  observe(previousText: string, nextText: string, now = Date.now()): RapidInsertionMetadata | null {
    const chars = Math.max(0, nextText.length - previousText.length);
    if (chars === 0) return null;

    if (chars >= SINGLE_CHANGE_LIMIT) {
      this.samples = [];
      return null;
    }

    this.samples.push({ at: now, chars });
    this.samples = this.samples.filter((sample) => now - sample.at <= WINDOW_MS);

    const insertedChars = this.samples.reduce((sum, sample) => sum + sample.chars, 0);
    if (insertedChars < THRESHOLD_CHARS
        || (this.lastFiredAt !== 0 && now - this.lastFiredAt < COOLDOWN_MS)) return null;

    this.lastFiredAt = now;
    const metadata = {
      insertedChars,
      changeCount: this.samples.length,
      windowMs: WINDOW_MS,
      maxSingleChange: Math.max(...this.samples.map((sample) => sample.chars)),
    };
    this.samples = [];
    return metadata;
  }
}
