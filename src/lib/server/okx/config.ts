import 'node:crypto'; // Node-only module: never import from browser components.

export type OkxEnv = Record<string, string | undefined>;
export type OkxMode = 'public' | 'demo' | 'live-readonly' | 'live';
const hosts: Record<string, string> = { global: 'https://openapi.okx.com', us: 'https://us.okx.com', eea: 'https://eea.okx.com', tr: 'https://tr.okx.com' };
export function getBaseUrl(env: OkxEnv = process.env): string {
  const region = env.OKX_REGION || 'global';
  if (!Object.hasOwn(hosts, region)) throw new Error('okx_invalid_region');
  const base = env.OKX_BASE_URL || hosts[region];
  if (![...Object.values(hosts), 'https://www.okx.com'].includes(base)) throw new Error('okx_invalid_host');
  return base;
}
export function getCredentialStatus(env: OkxEnv = process.env) {
  const status = (demo: boolean) => {
    const prefix = demo ? 'OKX_DEMO_' : 'OKX_';
    const missing = ['API_KEY', 'API_SECRET', 'API_PASSPHRASE'].filter((key) => !credentialValue(env, prefix, key)).map((key) => prefix + key);
    return { configured: missing.length === 0, missing };
  };
  return { live: status(false), demo: status(true) };
}
function credentialValue(env: OkxEnv, prefix: string, key: string): string {
  const alias = key === 'API_SECRET' ? 'SECRET_KEY' : key === 'API_PASSPHRASE' ? 'PASSPHRASE' : undefined;
  return env[prefix + key]?.trim() || (alias ? env[prefix + alias]?.trim() : '') || '';
}
export function getCredentials(mode: Exclude<OkxMode, 'public'>, env: OkxEnv) {
  const demo = mode === 'demo';
  if (!getCredentialStatus(env)[demo ? 'demo' : 'live'].configured) throw new Error('okx_credentials_missing');
  const prefix = demo ? 'OKX_DEMO_' : 'OKX_';
  return { key: credentialValue(env, prefix, 'API_KEY'), secret: credentialValue(env, prefix, 'API_SECRET'), passphrase: credentialValue(env, prefix, 'API_PASSPHRASE') };
}
