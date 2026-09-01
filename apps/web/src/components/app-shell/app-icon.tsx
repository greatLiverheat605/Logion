import type { SVGProps } from "react";

export type AppIconName =
  | "ai"
  | "archive"
  | "bell"
  | "book-open"
  | "calendar"
  | "chevron-down"
  | "clipboard"
  | "close"
  | "download"
  | "eye"
  | "eye-off"
  | "files"
  | "flask"
  | "folder"
  | "home"
  | "layout-template"
  | "lock"
  | "menu"
  | "moon"
  | "more"
  | "more-horizontal"
  | "plus"
  | "refresh"
  | "search"
  | "share"
  | "shield"
  | "sun"
  | "target"
  | "timer"
  | "unlock"
  | "upload"
  | "users";

const ICON_PATHS: Readonly<Record<AppIconName, readonly string[]>> = {
  ai: [
    "M12 3v3",
    "M12 18v3",
    "M3 12h3",
    "M18 12h3",
    "m5.6-5.6 2.1 2.1",
    "m16.3 16.3 2.1 2.1",
    "m18.4 5.6-2.1 2.1",
    "m7.7 16.3-2.1 2.1",
    "M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  ],
  archive: [
    "M4 7.5h16v11A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-11Z",
    "M3 4h18v3.5H3V4Z",
    "M9 12h6",
  ],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z", "M10 21h4"],
  "book-open": [
    "M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z",
    "M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z",
  ],
  calendar: [
    "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
    "M8 2v4",
    "M16 2v4",
    "M3 9h18",
  ],
  "chevron-down": ["m7 9 5 5 5-5"],
  clipboard: [
    "M8 4h8",
    "M9 2h6a1 1 0 0 1 1 1v3H8V3a1 1 0 0 1 1-1Z",
    "M6 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-1",
    "M8 11h8",
    "M8 15h6",
  ],
  close: ["M6 6l12 12", "M18 6 6 18"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
  eye: [
    "M2.1 12s3.6-7 9.9-7 9.9 7 9.9 7-3.6 7-9.9 7S2.1 12 2.1 12Z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  "eye-off": [
    "m3 3 18 18",
    "M10.6 5.2A10.4 10.4 0 0 1 12 5c6.3 0 9.9 7 9.9 7a16.7 16.7 0 0 1-2.1 3.1",
    "M6.2 6.2C3.6 8.1 2.1 12 2.1 12s3.6 7 9.9 7a9.5 9.5 0 0 0 4.1-.9",
    "M9.9 9.9A3 3 0 0 0 14.1 14.1",
  ],
  files: [
    "M7 3h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "M14 3v5h5",
    "M9 13h6",
    "M9 17h6",
  ],
  flask: [
    "M9 3h6",
    "M10 3v5l-5.5 9.2A2.5 2.5 0 0 0 6.7 21h10.6a2.5 2.5 0 0 0 2.2-3.8L14 8V3",
    "M7.5 15h9",
  ],
  folder: [
    "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z",
  ],
  home: ["m3 10 9-7 9 7", "M5 9v11h14V9", "M9 20v-6h6v6"],
  "layout-template": ["M4 4h16v16H4V4Z", "M4 9h16", "M10 9v11"],
  lock: [
    "M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Z",
    "M8 10V7a4 4 0 0 1 8 0v3",
    "M12 14v2",
  ],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  moon: ["M20.5 14.2A8 8 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  "more-horizontal": ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  plus: ["M12 5v14", "M5 12h14"],
  refresh: [
    "M20 7v5h-5",
    "M4 17v-5h5",
    "M18.5 10A7 7 0 0 0 6.7 6.7L4 9",
    "M5.5 14A7 7 0 0 0 17.3 17.3L20 15",
  ],
  search: ["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z", "m21 21-4.4-4.4"],
  share: [
    "M18 8a3 3 0 1 0-2.83-4",
    "M6 14a3 3 0 1 0 2.83 4",
    "M8.7 13.5l6.6-3",
    "M8.7 10.5l6.6 3",
  ],
  shield: [
    "M12 3 4.5 6v5.5c0 4.5 3 7.7 7.5 9.5 4.5-1.8 7.5-5 7.5-9.5V6L12 3Z",
    "m9 12 2 2 4-4",
  ],
  sun: [
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
    "M12 2v2",
    "M12 20v2",
    "m4.93 4.93 1.42 1.42",
    "m17.66 17.66 1.41 1.41",
    "M2 12h2",
    "M20 12h2",
    "m6.34 17.66-1.41 1.41",
    "m19.07 4.93-1.41 1.41",
  ],
  target: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
    "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  ],
  timer: ["M9 2h6", "M12 6v6l4 2", "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
  unlock: [
    "M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Z",
    "M8 10V7a4 4 0 0 1 7.6-1.75",
    "M12 14v2",
  ],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
};

export function AppIcon({
  name,
  size = 18,
  ...props
}: Readonly<
  { name: AppIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">
>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {ICON_PATHS[name].map((path) => (
        <path
          d={path}
          key={path}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      ))}
    </svg>
  );
}
