const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CurrentTenantConfig {
  slug: string;
  name: string;
  contactEmail: string;
  awsRegion: string;
  domainName: string;
  appUrl: string;
}

export interface TenantScopedPrincipal {
  role: string;
  tenantId?: number | null;
}

export function canManageTenantUser(actor: TenantScopedPrincipal, target: TenantScopedPrincipal): boolean {
  if (actor.role === 'superadmin') return true;
  return actor.role === 'tenant_admin'
    && Boolean(actor.tenantId)
    && target.role !== 'superadmin'
    && actor.tenantId === target.tenantId;
}

function decodeBase64(value: string | undefined): string {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export function getCurrentTenantConfig(env: NodeJS.ProcessEnv = process.env): CurrentTenantConfig {
  const legacySlug = (env.TENANT_SLUG || env.DEFAULT_TENANT_SLUG || 'fsa-cls').trim().toLowerCase();
  const requestedSlug = legacySlug === 'fsa' ? 'fsa-cls' : legacySlug;
  const slug = TENANT_SLUG_PATTERN.test(requestedSlug) ? requestedSlug : 'fsa-cls';
  const fallbackName = slug === 'fsa-cls'
    ? 'FSA CLS'
    : slug.replace(/(^|-)([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
  const requestedName = decodeBase64(env.DEFAULT_TENANT_NAME_B64) || env.DEFAULT_TENANT_NAME || fallbackName;
  const requestedEmail = (decodeBase64(env.DEFAULT_TENANT_CONTACT_EMAIL_B64) || env.DEFAULT_TENANT_CONTACT_EMAIL || 'admin@fsa-cls.local').trim().toLowerCase();
  const allowedOrigin = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).find(Boolean) || '';

  return {
    slug,
    name: requestedName.trim().replace(/[\r\n]/g, ' ').slice(0, 160) || fallbackName,
    contactEmail: EMAIL_PATTERN.test(requestedEmail) ? requestedEmail : 'admin@fsa-cls.local',
    awsRegion: (env.AWS_REGION || 'ap-southeast-1').trim(),
    domainName: (env.DEFAULT_TENANT_DOMAIN || '').trim().toLowerCase(),
    appUrl: (env.DEFAULT_TENANT_APP_URL || allowedOrigin).trim(),
  };
}
