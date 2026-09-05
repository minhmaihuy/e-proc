import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const recorderSource = fs.readFileSync(path.resolve(process.cwd(), 'client/src/services/examRecorder.ts'), 'utf8');
const publisherSource = fs.readFileSync(path.resolve(process.cwd(), 'client/src/services/livePublisher.ts'), 'utf8');

test('local and S3 recording reject unknown capture surfaces before sharing the stream live', () => {
  assert.match(recorderSource, /if \(surface !== 'monitor'\)/);
  assert.doesNotMatch(recorderSource, /if \(surface && surface !== 'monitor'\)/);
  assert.match(recorderSource, /export function getCaptureStream\(\): MediaStream \| null/);
  assert.match(recorderSource, /export function onCaptureStreamChanged/);
  assert.match(publisherSource, /examRecorder\.getCaptureStream\(\)/);
  assert.match(publisherSource, /examRecorder\.onCaptureStreamChanged/);
});
