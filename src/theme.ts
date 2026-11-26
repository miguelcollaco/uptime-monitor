import { useEffect, useState } from "react";

/** "system" follows the OS setting; "light" and "dark" override it. */
export type ThemePref = "system" | "light" | "dark";

// index.html reads the same key before first paint, so a saved theme never flashes.
const STORAGE_KEY = "theme";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** The theme preference, applied as `data-theme` on <html> and kept in localStorage. */
export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readPref);

  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
    try {
      if (pref === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Storage can be blocked (private mode); the choice then lasts for this visit.
    }
  }, [pref]);

  return [pref, setPref];
}
