import test from 'node:test';
import assert from 'node:assert/strict';
import { getPracticeCompilerMode, runCodeWithLambda } from './lambdaCompiler.js';

test('compiler mode is opt-in and defaults to local', () => {
  const previous = process.env.PRACTICE_COMPILER_MODE;
  delete process.env.PRACTICE_COMPILER_MODE;
  assert.equal(getPracticeCompilerMode(), 'local');
  process.env.PRACTICE_COMPILER_MODE = 'lambda';
  assert.equal(getPracticeCompilerMode(), 'lambda');
  if (previous === undefined) delete process.env.PRACTICE_COMPILER_MODE;
  else process.env.PRACTICE_COMPILER_MODE = previous;
});

test('Lambda compiler validates language and tenant configuration before invocation', async () => {
  const unsupported = await runCodeWithLambda(1, 'javascript', 'console.log(1)');
  assert.equal(unsupported.status, 400);

  const previousArn = process.env.PRACTICE_COMPILER_LAMBDA_ARN;
  delete process.env.PRACTICE_COMPILER_LAMBDA_ARN;
  const unconfigured = await runCodeWithLambda(1, 'python', 'print(1)');
  assert.equal(unconfigured.status, 503);
  if (previousArn === undefined) delete process.env.PRACTICE_COMPILER_LAMBDA_ARN;
  else process.env.PRACTICE_COMPILER_LAMBDA_ARN = previousArn;
});

test('Lambda compiler rejects oversized source before invoking AWS', async () => {
  const result = await runCodeWithLambda(1, 'python', `#${'x'.repeat(101 * 1024)}`);
  assert.equal(result.status, 400);
});
