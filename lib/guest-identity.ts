import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';

const COOKIE_NAME = 'aiocr_guest_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const IP_UA_SECRET = process.env.GUEST_IDENTITY_SECRET || 'aiocr-guest-default-v1';

export interface GuestIdentity {
  browserFingerprint: string | null;
  cookieId: string;
  ipUaHash: string;
  isNewCookie: boolean;
}

export function getGuestIdentity(
  request: NextRequest,
  browserFingerprint: string | null,
): GuestIdentity {
  const existingCookie = request.cookies.get(COOKIE_NAME)?.value;
  const cookieId = existingCookie ?? randomUUID();
  const isNewCookie = !existingCookie;

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';
  const ipUaHash = createHash('sha256')
    .update(`${ip}|${ua}|${IP_UA_SECRET}`)
    .digest('hex')
    .slice(0, 32);

  return { browserFingerprint, cookieId, ipUaHash, isNewCookie };
}

export function applyGuestCookie(response: NextResponse, identity: GuestIdentity): NextResponse {
  if (identity.isNewCookie) {
    response.cookies.set(COOKIE_NAME, identity.cookieId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });
  }
  return response;
}

export function identityKeys(identity: GuestIdentity): string[] {
  const keys: string[] = [`co:${identity.cookieId}`, `ip:${identity.ipUaHash}`];
  if (identity.browserFingerprint) keys.unshift(`fp:${identity.browserFingerprint}`);
  return keys;
}
