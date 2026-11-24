// Solid white glyph icon set (visual-languages HUD): single-color filled
// SVGs, redrawn from .plans/ui-redesign/mock/icons.svg as solid shapes.
// Icons take `currentColor`, so skin CSS controls the ink.
const SIZE = 16;

export interface IconProps {
  size?: number | undefined;
  className?: string | undefined;
}

// 2D camera / spectate ↔ tactical view toggle.
export function IconView({ size = SIZE, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 2 15 6 8 10 1 6Z M1 8.2 8 11.6 15 8.2V10L8 14 1 10Z" fill="currentColor" />
    </svg>
  );
}

export function IconLock({
  size = SIZE,
  className,
  locked = true,
}: IconProps & { locked?: boolean | undefined }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      {locked ? (
        <>
          <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
          <path
            d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2h-1.6V5a0.9 0.9 0 0 0-1.8 0v2Z"
            fill="currentColor"
          />
        </>
      ) : (
        <>
          <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
          <path
            d="M5.5 7V5a2.5 2.5 0 0 1 5-0.4V6L8.9 6.4V5a0.9 0.9 0 0 0-1.8 0v2Z"
            fill="currentColor"
          />
        </>
      )}
    </svg>
  );
}

// North-reset compass (also rotated live by the HUD via style transform).
export function IconCompass({ size = SIZE, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <polygon points="8,1 11.5,8 8,7 4.5,8" fill="currentColor" />
      <polygon points="8,15 11.5,8 8,9 4.5,8" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export function IconFullscreen({ size = SIZE, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        d="M2 2h4v1.8H4.4V6H2Zm12 0v4h-1.8V3.8H10V2ZM2 10h1.8v2.2H6V14H2Zm10.2 0H14v4h-4v-1.8h1.6V10Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Logistics overlay (linked nodes).
export function IconLink({ size = SIZE, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        d="M4 9.6 11.6 2v3.4h2.2L6.2 13v-3.4Zm8-5.6L6.4 9.6h3.2v2.4l5.6-5.6H12Z"
        fill="currentColor"
        transform="translate(0 0)"
      />
    </svg>
  );
}

// Key guide (keycap with K).
export function IconKeycap({ size = SIZE, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <text
        x="8"
        y="11.6"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill="currentColor"
        fontFamily="inherit"
      >
        K
      </text>
    </svg>
  );
}

// Cargo glyphs for the stock rows.
export function IconCargo({ id, size = SIZE, className }: IconProps & { id: string }) {
  const glyph =
    id.includes('power') || id.includes('energy')
      ? 'bolt'
      : id.includes('ore') || id.includes('metal')
        ? 'ore'
        : 'box';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      {glyph === 'bolt' && <path d="M9 1 3.5 9h3L6 15l5.5-8h-3Z" fill="currentColor" />}
      {glyph === 'ore' && <path d="M8 1.5 14 8 8 14.5 2 8Z" fill="currentColor" />}
      {glyph === 'box' && (
        <path
          d="M2 5.5 8 2l6 3.5v5L8 14l-6-3.5Zm6 1.6L4.4 5.4 8 3.5l3.6 1.9Z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

// Radar / minimap toggle.
export function IconRadar({ size = SIZE, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      <path d="M8 2.5v2M8 11.5v2M1.5 8h2M12.5 8h2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// Priority swap (two opposing arrows).
export function IconSwap({ size = SIZE, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        d="M3 5.5h7L8.4 3.9l1.3-1.3L12.7 5.6 9.7 8.6 8.4 7.3 10 5.7v-.2H3Zm10 5H6l1.6 1.6-1.3 1.3-3-3 3-3 1.3 1.3L6 10.3v.2h7Z"
        fill="currentColor"
      />
    </svg>
  );
}
