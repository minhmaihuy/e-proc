import assert from 'node:assert/strict';
import test from 'node:test';
import { TenantInput, validateTenantInput } from './tenantConfigurationPolicy.js';

const validInput: TenantInput = {
  name: 'Acme Vietnam',
  slug: 'acme-vietnam',
  contactEmail: 'ops@acme.example',
  awsRegion: 'ap-southeast-1',
  instanceType: 't3.micro',
  rootVolumeSize: 12,
  backupRetentionDays: 14,
  emailEnabled: false,
  emailFromName: null,
  emailDailyLimit: 200,
  quotaExamsPerMonth: null,
  quotaAiGradingsPerMonth: null,
  quotaRecordingGb: null,
  quotaEmailsPerMonth: null,
  identityVerification: 'off',
  identityRetentionDays: null,
  recordingRetentionDays: null,
  compilerEnabled: false,
  compilerMemoryMb: 512,
  compilerTimeoutSeconds: 15,
  compilerConcurrency: 2,
  domainName: 'epoc.acme-vietnam.devfasttrack.com',
  route53ZoneId: 'Z123456789',
  secretArn: '',
  allowedRecordModes: 'none,local',
  repositoryUrl: 'https://github.com/minhmaihuy/e-proc.git',
  repositoryRef: 'main',
};

test('draft updates skip all business and infrastructure validation', () => {
  const intentionallyInvalid: TenantInput = {
    ...validInput,
    name: '',
    contactEmail: 'not-an-email',
    awsRegion: 'invalid',
    rootVolumeSize: -1,
    identityVerification: 'photo',
    route53ZoneId: 'legacy/hosted-zone',
    repositoryUrl: 'legacy-repository',
  };

  assert.equal(validateTenantInput(intentionallyInvalid, 'update'), null);
});
test('create and approval still reject an invalid Route53 hosted zone ID', () => {
  const legacyRoute53 = { ...validInput, route53ZoneId: 'legacy/hosted-zone' };
  assert.equal(validateTenantInput(legacyRoute53, 'create'), 'Invalid Route53 hosted zone ID.');
  assert.equal(validateTenantInput(legacyRoute53, 'approval'), 'Invalid Route53 hosted zone ID.');
});

test('create permits an omitted secret while approval requires it', () => {
  assert.equal(validateTenantInput(validInput, 'create'), null);
  assert.equal(validateTenantInput(validInput, 'approval'), 'A Secrets Manager ARN is required.');
});
