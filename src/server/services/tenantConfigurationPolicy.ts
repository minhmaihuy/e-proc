import { isTenantDomainForSlug, tenantDomainForSlug } from '../tenantContext.js';
import { isBackupRetentionDays } from './backupPolicy.js';
import { IdentityMode, validateEvidenceRetention } from './identityPolicy.js';
import { parseAllowedRecordModes } from './recordingPolicy.js';

const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-[0-9]$/;
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const INSTANCE_TYPES = new Set(['t3.micro', 't3.small', 't3.medium', 't4g.micro', 't4g.small', 't4g.medium']);
const SECRET_ARN_PATTERN = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;
const ROUTE53_HOSTED_ZONE_ID_PATTERN = /^[A-Z0-9]{6,64}$/;

export type TenantValidationPhase = 'create' | 'update' | 'approval';

export interface TenantInput {
  name: string;
  slug: string;
  contactEmail: string;
  awsRegion: string;
  instanceType: string;
  rootVolumeSize: number;
  backupRetentionDays: number;
  emailEnabled: boolean;
  emailFromName: string | null;
  emailDailyLimit: number;
  quotaExamsPerMonth: number | null;
  quotaAiGradingsPerMonth: number | null;
  quotaRecordingGb: number | null;
  quotaEmailsPerMonth: number | null;
  identityVerification: IdentityMode;
  identityRetentionDays: number | null;
  recordingRetentionDays: number | null;
  compilerEnabled: boolean;
  compilerMemoryMb: number;
  compilerTimeoutSeconds: number;
  compilerConcurrency: number;
  domainName: string;
  route53ZoneId: string;
  secretArn: string;
  allowedRecordModes: string;
  repositoryUrl: string;
  repositoryRef: string;
}
export function isRoute53HostedZoneId(value: string): boolean {
  return ROUTE53_HOSTED_ZONE_ID_PATTERN.test(value);
}

export function validateTenantInput(input: TenantInput, phase: TenantValidationPhase): string | null {
  // Product rule: PUT saves a draft. Approval and provisioning remain the
  // validation boundaries, so incomplete legacy infrastructure values cannot
  // block an unrelated configuration update.
  if (phase === 'update') return null;

  if (input.name.length < 2 || input.name.length > 160) return 'Tenant name must be 2-160 characters.';
  if (!SLUG_PATTERN.test(input.slug)) return 'Slug must be 3-31 lowercase letters, numbers or hyphens.';
  if (!EMAIL_PATTERN.test(input.contactEmail) || input.contactEmail.length > 254) return 'A valid contact email is required.';
  if (!REGION_PATTERN.test(input.awsRegion)) return 'Invalid AWS region.';
  if (!INSTANCE_TYPES.has(input.instanceType)) return 'Unsupported EC2 instance type.';
  if (!Number.isInteger(input.rootVolumeSize) || input.rootVolumeSize < 8 || input.rootVolumeSize > 100) return 'Root volume must be 8-100 GiB.';
  if (!isBackupRetentionDays(input.backupRetentionDays)) return 'Backup retention must be 1-35 days.';
  if (input.emailFromName && input.emailFromName.length > 160) return 'Email sender name must be at most 160 characters.';
  if (!Number.isInteger(input.emailDailyLimit) || input.emailDailyLimit < 1 || input.emailDailyLimit > 50000) return 'Email daily limit must be 1-50000.';
  for (const [label, value] of [
    ['Exam quota', input.quotaExamsPerMonth],
    ['AI grading quota', input.quotaAiGradingsPerMonth],
    ['Email quota', input.quotaEmailsPerMonth],
  ] as const) {
    if (value != null && (!Number.isInteger(value) || value < 1)) return `${label} must be a positive integer or unlimited.`;
  }
  if (input.quotaRecordingGb != null && (!Number.isFinite(input.quotaRecordingGb) || input.quotaRecordingGb <= 0)) return 'Recording quota must be positive or unlimited.';
  if (input.identityVerification === 'face_match') return 'Face matching is not available in this release.';
  const retentionError = validateEvidenceRetention({
    identityMode: input.identityVerification,
    s3RecordingEnabled: parseAllowedRecordModes(input.allowedRecordModes).includes('s3'),
    identityRetentionDays: input.identityRetentionDays,
    recordingRetentionDays: input.recordingRetentionDays,
  });
  if (retentionError) return retentionError;
  if (!Number.isInteger(input.compilerMemoryMb) || input.compilerMemoryMb < 256 || input.compilerMemoryMb > 3008) return 'Compiler memory must be 256-3008 MB.';
  if (!Number.isInteger(input.compilerTimeoutSeconds) || input.compilerTimeoutSeconds < 10 || input.compilerTimeoutSeconds > 30) return 'Compiler timeout must be 10-30 seconds.';
  if (!Number.isInteger(input.compilerConcurrency) || input.compilerConcurrency < 1 || input.compilerConcurrency > 20) return 'Compiler concurrency must be 1-20.';
  if (input.domainName && !DOMAIN_PATTERN.test(input.domainName)) return 'Domain name must be a valid FQDN.';
  const requiredDomain = tenantDomainForSlug(input.slug);
  if (input.domainName && !isTenantDomainForSlug(input.domainName, input.slug)) return `Domain name must be ${requiredDomain}.`;
  if (input.route53ZoneId && !isRoute53HostedZoneId(input.route53ZoneId)) return 'Invalid Route53 hosted zone ID.';
  if (input.secretArn && !SECRET_ARN_PATTERN.test(input.secretArn)) return 'Invalid AWS Secrets Manager ARN.';
  if (phase === 'approval' && !input.secretArn) return 'A Secrets Manager ARN is required.';
  if (phase === 'approval' && !input.domainName) return 'A dedicated tenant domain is required before approval.';
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(input.repositoryUrl)) return 'Repository must be an HTTPS GitHub .git URL.';
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(input.repositoryRef) || input.repositoryRef.includes('..')) return 'Invalid repository ref.';
  return null;
}
