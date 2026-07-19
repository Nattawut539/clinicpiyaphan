import { API_ORIGIN } from '@/lib/api';

export function resolveBackendImage(src?: string | null) {
  if (!src) return null;
  if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('/img/')) return src;
  if (src.startsWith('/uploads') || src.startsWith('uploads')) {
    return `${API_ORIGIN}/${src.replace(/^\//, '')}`;
  }
  return src;
}
