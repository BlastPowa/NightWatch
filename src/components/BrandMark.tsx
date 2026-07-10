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
        <path className="brand-mark-orbit" d="M46.7 11.4A25 25 0 1 0 53 45.9 21 21 0 1 1 46.7 11.4Z" />
        <path className="brand-mark-n" d="M16 43V21h6l12 14V21h6v22h-6L22 29v14Z" />
        <path className="brand-mark-w" d="m28 21 5 22h6l4-11 4 11h6l6-22h-7l-3 13-4-13h-5l-4 13-2-13Z" />
        <circle className="brand-mark-star" cx="49" cy="16" r="2.5" />
      </svg>
    </span>
  );
}
