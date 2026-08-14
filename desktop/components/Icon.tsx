import type { SVGProps } from "react";

export type IconName =
  | "activity"
  | "agents"
  | "approval"
  | "arrow"
  | "check"
  | "chevron"
  | "dashboard"
  | "layers"
  | "pause"
  | "play"
  | "plug"
  | "project"
  | "refresh"
  | "runs"
  | "settings"
  | "source"
  | "workflow"
  | "x";

const paths: Record<IconName, React.ReactNode> = {
  activity: <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />,
  agents: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2" />
      <path d="M3.5 19c.7-3.2 2.4-5 5.5-5s4.8 1.8 5.5 5M15 15c2.7-.2 4.4 1.1 5 3.5" />
    </>
  ),
  approval: (
    <>
      <path d="M12 3 4.5 6v5c0 4.7 3.1 8.3 7.5 10 4.4-1.7 7.5-5.3 7.5-10V6L12 3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3-9 5 9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  pause: (
    <>
      <path d="M8 6v12M16 6v12" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  plug: (
    <>
      <path d="M8 12h8M9 3v5m6-5v5M7 8h10v2a5 5 0 0 1-5 5v6" />
    </>
  ),
  project: (
    <>
      <path d="M4 5h6l2 2h8v12H4V5Z" />
      <path d="M4 10h16" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M18.2 9A7 7 0 0 0 6.7 6.2L4 9m16 6-2.7 2.8A7 7 0 0 1 5.8 15" />
    </>
  ),
  runs: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  source: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="m8 7.5 3 8m5-8-3 8" />
    </>
  ),
  workflow: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="12" r="2" />
      <circle cx="5" cy="19" r="2" />
      <path d="M7 5h3a4 4 0 0 1 4 4v0a3 3 0 0 0 3 3M7 19h3a4 4 0 0 0 4-4v0a3 3 0 0 1 3-3" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
