import { useEffect, useState } from 'react';

interface ProfileAvatarProps {
  name: string;
  src: string | null;
  className?: string;
}

/** Discord avatar with a stable initial fallback for missing/expired CDN images. */
export function ProfileAvatar({ name, src, className = '' }: ProfileAvatarProps): JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (src !== null && !failed) {
    return <img className={className} src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }

  return <span className={`${className} profile-avatar-fallback`} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}
