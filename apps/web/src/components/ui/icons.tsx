// Minimal inline icon set for the nav — kept as plain SVG (matching the
// existing org-switcher chevron in app-shell.tsx) instead of pulling in an
// icon library for three glyphs.

type IconProps = { className?: string };

export function InvoicesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M5 3.5h10a1 1 0 011 1V17l-2.5-1.5L11 17l-1-1.5L9 17l-2.5-1.5L4 17V4.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.5 7h7M6.5 9.8h7M6.5 12.6h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ActivityIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 6.8V10.5l2.6 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 2.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function MembersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="7.2" cy="7" r="2.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.8 16c0-2.6 2-4 4.4-4s4.4 1.4 4.4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="14.2" cy="6.4" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M12.6 9.6c1.9-.3 3.9.9 4 3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3L4.9 4.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M16.5 12.3A6.8 6.8 0 018 4.2c0-.5 0-1 .1-1.5a7.3 7.3 0 108.9 9c-.2 0-.3.1-.5.1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
