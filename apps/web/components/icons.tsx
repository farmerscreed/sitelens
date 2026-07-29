// Inline SVG icon set — self-contained (no external icon dependency).
// Stroke-based, inherits currentColor. 20px default.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const IconGrid = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>
);
export const IconBoard = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="4.5" height="16" rx="1.2" /><rect x="9.75" y="4" width="4.5" height="11" rx="1.2" /><rect x="16.5" y="4" width="4.5" height="14" rx="1.2" /></svg>
);
export const IconCalendar = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
);
export const IconBox = (p: P) => (
  <svg {...base(p)}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
);
export const IconReceipt = (p: P) => (
  <svg {...base(p)}><path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3 5 4.5Z" /><path d="M8.5 8.5h7M8.5 12h7" /></svg>
);
export const IconTag = (p: P) => (
  <svg {...base(p)}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6Z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>
);
export const IconLayers = (p: P) => (
  <svg {...base(p)}><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></svg>
);
export const IconUpload = (p: P) => (
  <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v13M7 8l5-5 5 5" /></svg>
);
export const IconSpark = (p: P) => (
  <svg {...base(p)}><path d="M12 3v3M12 18v3M5 12H2M22 12h-3M12 7.5 13.4 11 17 12l-3.6 1L12 16.5 10.6 13 7 12l3.6-1L12 7.5Z" /></svg>
);
export const IconChat = (p: P) => (
  <svg {...base(p)}><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9 9 0 0 1-3.9-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" /></svg>
);
export const IconLink = (p: P) => (
  <svg {...base(p)}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.4M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.4" /></svg>
);
export const IconBell = (p: P) => (
  <svg {...base(p)}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
);
export const IconBuilding = (p: P) => (
  <svg {...base(p)}><path d="M3 21h18M6 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17M15 8h3a1 1 0 0 1 1 1v12" /><path d="M9 7h1.5M9 11h1.5M9 15h1.5" /></svg>
);
export const IconMenu = (p: P) => (
  <svg {...base(p)}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconAlert = (p: P) => (
  <svg {...base(p)}><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
export const IconLogo = (p: P) => (
  <svg {...base({ strokeWidth: 1.6, ...p })}><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" /><path d="M12 22V12M3 7l9 5 9-5" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /></svg>
);
