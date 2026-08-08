const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEGACY_FSA_DOMAINS = new Set([
  'epoc-fsa-cls.devfasttrack.cloud',
  'epoc.devfasttrack.cloud',
  'epoc.fsa.devfasttrack.com',
]);
const LEGACY_FSA_APP_URLS = new Set(
  [...LEGACY_FSA_DOMAINS].flatMap((domain) => [`https://${domain}`, `https://${domain}/`]),
);

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
  return actor.role === 'tenant_admin'
    && Boolean(actor.tenantId)
    && target.role !== 'superadmin'
    && actor.tenantId === target.tenantId;
}

export function tenantDomainForSlug(inputSlug: string): string {
  const requestedSlug = inputSlug.trim().toLowerCase();
  const slug = requestedSlug === 'fsa' ? 'fsa-cls' : requestedSlug;
  if (!TENANT_SLUG_PATTERN.test(slug)) return '';
  if (slug === 'fsa-cls') return 'epoc.devfasttrack.com';
  return `epoc.${slug}.devfasttrack.com`;
}

export function isTenantDomainForSlug(domainName: string, slug: string): boolean {
  const expected = tenantDomainForSlug(slug);
  return Boolean(expected) && domainName.trim().toLowerCase() === expected;
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
  const fallbackDomain = tenantDomainForSlug(slug);
  const configuredDomain = (env.DEFAULT_TENANT_DOMAIN || '').trim().toLowerCase();
  const domainName = !configuredDomain || (slug === 'fsa-cls' && LEGACY_FSA_DOMAINS.has(configuredDomain))
    ? fallbackDomain
    : configuredDomain;
  const configuredAppUrl = (env.DEFAULT_TENANT_APP_URL || '').trim();
  const appUrl = (!configuredAppUrl || (slug === 'fsa-cls' && LEGACY_FSA_APP_URLS.has(configuredAppUrl.toLowerCase())))
    ? ((domainName ? `https://${domainName}/` : '') || allowedOrigin)
    : configuredAppUrl;

  return {
    slug,
    name: requestedName.trim().replace(/[\r\n]/g, ' ').slice(0, 160) || fallbackName,
    contactEmail: EMAIL_PATTERN.test(requestedEmail) ? requestedEmail : 'admin@fsa-cls.local',
    awsRegion: (env.AWS_REGION || 'ap-southeast-1').trim(),
    domainName,
    appUrl,
  };
}
