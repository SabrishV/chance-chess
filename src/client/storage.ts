// Small wrappers around browser storage. Storage can be unavailable (private
// mode, blocked cookies), so every access falls back gracefully.

export function loadValue<T>(key: string, fallback: T, store: 'local' | 'session' = 'local'): T {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveValue(key: string, value: unknown, store: 'local' | 'session' = 'local'): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // Not fatal: the value just won't be remembered.
  }
}

function randomToken(): string {
  // crypto.getRandomValues works on plain-http LAN addresses, unlike randomUUID.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Secret that identifies this browser tab as a player, so a reload rejoins the
 * same seat. Kept per tab so two tabs can play each other while testing.
 */
export function playerToken(): string {
  let token = loadValue<string | null>('cc:token', null, 'session');
  if (!token) {
    token = randomToken();
    saveValue('cc:token', token, 'session');
  }
  return token;
}
