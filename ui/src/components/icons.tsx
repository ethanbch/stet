// Small line icons, 16px, drawn with currentColor.
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconToday = () => (
  <svg {...base} aria-hidden>
    <rect x="2.5" y="3" width="11" height="10.5" rx="2" />
    <path d="M2.5 6.5h11M5.5 1.8v2.4M10.5 1.8v2.4" />
  </svg>
);
export const IconReview = () => (
  <svg {...base} aria-hidden>
    <path d="M3 8.5l3 3 7-7" />
  </svg>
);
export const IconWiki = () => (
  <svg {...base} aria-hidden>
    <path d="M3 2.5h7.5L13 5v8.5H3z" />
    <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" />
  </svg>
);
export const IconGraph = () => (
  <svg {...base} aria-hidden>
    <circle cx="4" cy="4.5" r="1.8" />
    <circle cx="12" cy="4" r="1.8" />
    <circle cx="8" cy="12" r="1.8" />
    <path d="M5.6 5.4l1.6 4.9M10.6 5.2l-1.8 5M5.8 4.4h4.4" />
  </svg>
);
export const IconChecks = () => (
  <svg {...base} aria-hidden>
    <path d="M8 1.8l5.5 2v4c0 3.2-2.4 5.3-5.5 6.4C4.9 13.1 2.5 11 2.5 7.8v-4z" />
    <path d="M5.6 8l1.7 1.7 3.2-3.4" />
  </svg>
);
export const IconSearch = () => (
  <svg {...base} aria-hidden>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4L13.5 13.5" />
  </svg>
);
export const IconArrow = () => (
  <svg {...base} aria-hidden>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);
export const IconTheme = ({ mode }: { mode: "system" | "light" | "dark" }) => (
  <svg {...base} aria-hidden>
    <circle cx="8" cy="8" r="5.5" />
    {mode === "system" && <path d="M8 2.5v11" />}
    {mode === "light" && <circle cx="8" cy="8" r="2" fill="currentColor" />}
    {mode === "dark" && <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />}
  </svg>
);
