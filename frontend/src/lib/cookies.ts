type CookieOptions = {
  expires?: number | Date;
  path?: string;
  sameSite?: 'strict' | 'lax' | 'none';
  secure?: boolean;
};

function get(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  if (!item) return undefined;
  try {
    return decodeURIComponent(item.slice(prefix.length));
  } catch {
    return item.slice(prefix.length);
  }
}

function set(name: string, value: string, options: CookieOptions = {}) {
  if (typeof document === 'undefined') return;
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (typeof options.expires === 'number') {
    const expiresAt = new Date(Date.now() + options.expires * 86_400_000);
    parts.push(`Expires=${expiresAt.toUTCString()}`);
  } else if (options.expires instanceof Date) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}

function remove(name: string, options: CookieOptions = {}) {
  set(name, '', { ...options, expires: new Date(0) });
}

const Cookies = { get, set, remove };

export default Cookies;
