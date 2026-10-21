/**
 * Prangon Lite — offline image helpers for the mock data layer.
 *
 * Generates deterministic, dependency-free images as data URIs so the mock
 * data renders identically in any browser without network access, plus
 * seeded photo URLs for post/reel media when a richer look is wanted.
 */

const PALETTES: [string, string, string][] = [
  ["#FF4F5A", "#FF8A5C", "#ffffff"],
  ["#5C7CFF", "#8A5CFF", "#ffffff"],
  ["#00B8A9", "#3DFFC3", "#062B28"],
  ["#FFC75F", "#FF8A5C", "#3B2300"],
  ["#7C5CFF", "#FF5CC8", "#ffffff"],
  ["#2B3A67", "#5C7CFF", "#ffffff"],
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const svgDataUri = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Initials avatar with a stable gradient per key (e.g. a username). */
export function avatarDataUri(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
    .padEnd(1, name[0]?.toUpperCase() ?? "P");
  const [a, b, fg] = PALETTES[hashString(name) % PALETTES.length];
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="160" height="160" fill="url(#g)"/>
  <text x="80" y="80" dy="0.36em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="58" font-weight="700" fill="${fg}">${esc(initials)}</text>
</svg>`,
  );
}

/** Decorative gradient cover (group banners, page headers, empty states). */
export function coverDataUri(key: string, label = ""): string {
  const [a, b, fg] = PALETTES[hashString(key) % PALETTES.length];
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="800" height="420" fill="url(#g)"/>
  <circle cx="660" cy="80" r="150" fill="#ffffff" opacity="0.14"/>
  <circle cx="120" cy="360" r="90" fill="#000000" opacity="0.10"/>
  ${label ? `<text x="40" y="360" font-family="system-ui, sans-serif" font-size="34" font-weight="700" fill="${fg}">${esc(label)}</text>` : ""}
</svg>`,
  );
}

/**
 * Seeded "photo" for posts and reels. Uses picsum (stable per seed) — the
 * browser loads these directly in <img>, which the mock fetch interceptor
 * does not touch.
 */
export function photoUrl(seed: string, w = 900, h = 1200): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}
