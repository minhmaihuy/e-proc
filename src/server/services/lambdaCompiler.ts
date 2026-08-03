import crypto from 'crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const MAX_CODE_BYTES = 100 * 1024;
const MAX_STDIN_BYTES = 10 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const MAX_RUNS_PER_WINDOW = 10;
const FUNCTION_ARN_PATTERN = /^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9-_]{1,64}$/;

export const LAMBDA_COMPILER_LANGUAGES = ['c', 'cpp', 'python', 'java'] as const;

export interface CompilerRunResult {
  ok: boolean;
  phase: 'setup' | 'compile' | 'run';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  runner: 'lambda';
}

export interface CompilerResponse {
  status: number;
  body: CompilerRunResult | { error: string };
}

interface RateState {
  startedAt: number;
  count: number;
}

const rateByStudent = new Map<number, RateState>();
const inFlightStudents = new Set<number>();
let lambdaClient: LambdaClient | undefined;
let clientRegion = '';

export function getPracticeCompilerMode(): 'lambda' | 'local' {
  return process.env.PRACTICE_COMPILER_MODE?.trim().toLowerCase() === 'lambda' ? 'lambda' : 'local';
}

function getClient(): LambdaClient {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (!region) throw new Error('AWS_REGION is required for Lambda compiler mode.');
  if (!lambdaClient || clientRegion !== region) {
    lambdaClient?.destroy();
    lambdaClient = new LambdaClient({ region });
    clientRegion = region;
  }
  return lambdaClient;
}

function validateRequest(language: string, code: string, stdin: string): string | null {
  if (!(LAMBDA_COMPILER_LANGUAGES as readonly string[]).includes(language)) {
    return `Unsupported Lambda compiler language. Supported: ${LAMBDA_COMPILER_LANGUAGES.join(', ')}.`;
  }
  if (!code.trim()) return 'Code is required.';
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) return 'Code exceeds the 100 KB limit.';
  if (Buffer.byteLength(stdin, 'utf8') > MAX_STDIN_BYTES) return 'Standard input exceeds the 10 KB limit.';
  return null;
}

function consumeRateLimit(studentId: number): boolean {
  const now = Date.now();
  const current = rateByStudent.get(studentId);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateByStudent.set(studentId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_RUNS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function isCompilerResult(value: unknown): value is Omit<CompilerRunResult, 'runner'> & { runner?: unknown } {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.ok === 'boolean'
    && ['setup', 'compile', 'run'].includes(String(result.phase))
    && typeof result.stdout === 'string'
    && typeof result.stderr === 'string'
    && (result.exitCode === null || Number.isInteger(result.exitCode))
    && typeof result.timedOut === 'boolean'
    && typeof result.durationMs === 'number';
}

function boundedOutput(value: string): string {
  return Buffer.from(value, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8');
}

export async function runCodeWithLambda(
  studentId: number,
  languageValue: string,
  code: string,
  stdinValue = '',
): Promise<CompilerResponse> {
  const language = languageValue.trim().toLowerCase();
  const stdin = stdinValue || '';
  const validationError = validateRequest(language, code, stdin);
  if (validationError) return { status: 400, body: { error: validationError } };

  const functionArn = process.env.PRACTICE_COMPILER_LAMBDA_ARN?.trim() || '';
  if (!FUNCTION_ARN_PATTERN.test(functionArn)) {
    return { status: 503, body: { error: 'Lambda compiler is not configured for this tenant.' } };
  }
  if (inFlightStudents.has(studentId)) {
    return { status: 409, body: { error: 'A compiler run is already in progress for this student.' } };
  }
  if (!consumeRateLimit(studentId)) {
    return { status: 429, body: { error: 'Compiler rate limit reached. Please wait before running again.' } };
  }

  inFlightStudents.add(studentId);
  try {
    const requestId = crypto.randomUUID();
    const response = await getClient().send(new InvokeCommand({
      FunctionName: functionArn,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ requestId, language, code, stdin })),
    }));

    if (response.FunctionError) {
      console.error('[LambdaCompiler] Function error', { requestId, functionError: response.FunctionError });
      return { status: 502, body: { error: 'The isolated compiler failed to execute the request.' } };
    }

    const raw = response.Payload ? Buffer.from(response.Payload).toString('utf8') : '';
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
      if (decoded && typeof decoded === 'object' && typeof (decoded as { body?: unknown }).body === 'string') {
        decoded = JSON.parse((decoded as { body: string }).body);
      }
    } catch {
      console.error('[LambdaCompiler] Invalid response', { requestId });
      return { status: 502, body: { error: 'The isolated compiler returned an invalid response.' } };
    }

    if (!isCompilerResult(decoded)) {
      return { status: 502, body: { error: 'The isolated compiler returned an invalid result.' } };
    }
    return {
      status: 200,
      body: {
        ok: decoded.ok,
        phase: decoded.phase,
        stdout: boundedOutput(decoded.stdout),
        stderr: boundedOutput(decoded.stderr),
        exitCode: decoded.exitCode,
        timedOut: decoded.timedOut,
        durationMs: Math.max(0, Math.round(decoded.durationMs)),
        runner: 'lambda',
      },
    };
  } catch (error: unknown) {
    const errorName = error && typeof error === 'object' && 'name' in error ? String(error.name) : 'UnknownError';
    console.error('[LambdaCompiler] Invocation failed', { errorName });
    return { status: 502, body: { error: 'Unable to reach the isolated compiler.' } };
  } finally {
    inFlightStudents.delete(studentId);
  }
}
