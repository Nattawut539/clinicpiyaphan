export type ProfileUpdate = {
  first_name?: string | null;
  last_name?: string | null;
  profile_image?: string | null;
  role?: string | null;
  email?: string | null;
};

export type ProfileUpdateDetail = {
  profile: ProfileUpdate;
  imageVersion?: string;
};

export const PROFILE_UPDATED_EVENT = 'clinic:profile-updated';

export function publishProfileUpdate(profile: ProfileUpdate, imageChanged: boolean) {
  const imageVersion = imageChanged ? String(Date.now()) : undefined;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ProfileUpdateDetail>(PROFILE_UPDATED_EVENT, {
      detail: { profile, imageVersion },
    }));
  }

  return imageVersion;
}

export function withImageVersion(src: string | null, version?: string) {
  if (!src || !version || src.startsWith('blob:') || src.startsWith('data:')) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}v=${encodeURIComponent(version)}`;
}
