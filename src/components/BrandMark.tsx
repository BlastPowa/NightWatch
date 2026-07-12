interface BrandMarkProps {
  className?: string;
  decorative?: boolean;
}

/** Scalable NightWatch monogram, crisp from the navigation rail to app-icon sizes. */
export function BrandMark({ className = '', decorative = true }: BrandMarkProps): JSX.Element {
  return (
    <span
      className={`brand-mark ${className}`.trim()}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : 'NightWatch'}
    >
      <svg viewBox="0 0 64 64" role="img" focusable="false">
        <path className="brand-mark-orbit" d="M46.5 9.5A25.5 25.5 0 1 0 55 45.8 21.5 21.5 0 1 1 46.5 9.5Z" />
        <path className="brand-mark-n" d="M14.5 43V21L29 43V21" />
        <path className="brand-mark-w" d="m29 21 6 22 6-13 6 13 6-22" />
        <circle className="brand-mark-star" cx="48.5" cy="15.5" r="2.25" />
      </svg>
    </span>
  );
}
