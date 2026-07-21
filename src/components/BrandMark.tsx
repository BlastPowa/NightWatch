interface BrandMarkProps {
  className?: string;
  decorative?: boolean;
}

/** Moon-and-play NightWatch emblem shared by navigation, splash, and desktop art. */
export function BrandMark({ className = '', decorative = true }: BrandMarkProps): JSX.Element {
  return (
    <span
      className={`brand-mark ${className}`.trim()}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : 'NightWatch'}
    >
      <span className="brand-mark-accent" aria-hidden="true" />
      <img src="/brand/nightwatch-moon-play-v2-cropped.png" alt="" draggable={false} />
    </span>
  );
}
