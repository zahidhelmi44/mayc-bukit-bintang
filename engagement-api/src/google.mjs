const encoder = new TextEncoder();
let cachedKeys = [];
let expiresAt = 0;
let fetchedAt = 0;
export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function bytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError('Please sign in with Google again.', 401);
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function verifyGoogleToken(token, clientId, { fetcher = fetch, now = Date.now() } = {}) {
  if (!clientId) throw new ApiError('Google sign-in is not configured yet.', 503);
  if (typeof token !== 'string' || token.length > 12000) throw new ApiError('Please sign in with Google.', 401);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid algorithm');
    if (now >= expiresAt || (!cachedKeys.some(k => k.kid === header.kid) && now - fetchedAt > 60000)) {
      const response = await fetcher('https://www.googleapis.com/oauth2/v3/certs');
      if (!response.ok) throw new ApiError('Google sign-in is temporarily unavailable. Please retry.', 503);
      const data = await response.json();
      if (!Array.isArray(data.keys)) throw new ApiError('Google sign-in is temporarily unavailable.', 503);
      cachedKeys = data.keys;
      const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 3600);
      fetchedAt = now;
      expiresAt = now + Math.min(maxAge, 86400) * 1000;
    }
    const jwk = cachedKeys.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) throw new Error('Unknown signing key');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    const seconds = now / 1000;
    if (!valid || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
      || claims.aud !== clientId || (claims.azp && claims.azp !== clientId)
      || typeof claims.exp !== 'number' || claims.exp <= seconds
      || typeof claims.iat !== 'number' || claims.iat > seconds + 60
      || (claims.nbf && claims.nbf > seconds + 60)
      || typeof claims.sub !== 'string' || !/^[0-9]{1,255}$/.test(claims.sub)
      || claims.email_verified !== true) throw new Error('Invalid claims');
    return { sub: claims.sub, name: String(claims.name || claims.given_name || 'Google user').trim().slice(0, 100) || 'Google user' };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Your Google sign-in has expired or is invalid. Please sign in again.', 401);
  }
}
