import type { ReactNode } from "react";
import { useTheme, type ThemePref } from "../theme";

const icon = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const SunIcon = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MonitorIcon = () => (
  <svg {...icon}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const MoonIcon = () => (
  <svg {...icon}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

export const LockIcon = () => (
  <svg {...icon}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const ArrowLeftIcon = () => (
  <svg {...icon}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

const THEMES: { value: ThemePref; label: string; Icon: () => ReactNode }[] = [
  { value: "light", label: "Light theme", Icon: SunIcon },
  { value: "system", label: "Match system theme", Icon: MonitorIcon },
  { value: "dark", label: "Dark theme", Icon: MoonIcon },
];

export function ThemeToggle() {
  const [pref, setPref] = useTheme();
  return (
    <div className="segmented" role="group" aria-label="Theme">
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="segmented__option"
          aria-label={label}
          aria-pressed={pref === value}
          title={label}
          onClick={() => setPref(value)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

/** Site name on the left; theme switch and one navigation button on the right. */
export function TopBar({
  title,
  link,
}: {
  title: string;
  link: { href: string; label: string; icon: ReactNode };
}) {
  return (
    <header className="topbar">
      <a className="topbar__brand" href="/">
        {title}
      </a>
      <nav className="topbar__actions">
        <ThemeToggle />
        <a className="btn btn--small btn--ghost" href={link.href}>
          {link.icon}
          {link.label}
        </a>
      </nav>
    </header>
  );
}
