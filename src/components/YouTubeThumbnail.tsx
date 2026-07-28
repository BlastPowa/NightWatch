import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { resolveExternalAssetUrl } from '@/lib/assets';
import { getYouTubeThumbnailCandidates, type YouTubeThumbnailKind } from '@/lib/youtubeThumbnails';

interface YouTubeThumbnailProps {
  videoId: string;
  suppliedUrl: string;
  kind: YouTubeThumbnailKind;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
  onUnavailable?(event: SyntheticEvent<HTMLImageElement>): void;
}

/**
 * Renders one official YouTube artwork image and walks down a safe size chain
 * when an upload has no max-resolution/HQ rendition.  This deliberately uses
 * images only; it does not alter the official YouTube playback boundary.
 */
export function YouTubeThumbnail({ videoId, suppliedUrl, kind, alt, className, loading = 'lazy', onUnavailable }: YouTubeThumbnailProps): JSX.Element {
  const candidates = useMemo(
    () => getYouTubeThumbnailCandidates(videoId, suppliedUrl, kind),
    [kind, suppliedUrl, videoId],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => setCandidateIndex(0), [candidates]);

  const source = candidates[candidateIndex] ?? '';
  const resolvedSource = resolveExternalAssetUrl(source) ?? '';

  function handleError(event: SyntheticEvent<HTMLImageElement>): void {
    if (candidateIndex < candidates.length - 1) {
      setCandidateIndex((current) => current + 1);
      return;
    }
    onUnavailable?.(event);
  }

  return <img className={className} src={resolvedSource} alt={alt} loading={loading} decoding="async" onError={handleError} />;
}
