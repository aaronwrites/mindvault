export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "mindvault-theme";

// Runs before the body is painted; intentionally independent of React hydration.
export const themeInitializationScript = `(() => {
  let preference = 'system';
  try { const saved = localStorage.getItem('${THEME_STORAGE_KEY}'); if (saved === 'light' || saved === 'dark') preference = saved; } catch {}
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();`;

function storedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch { /* Theme switching also works when browser storage is unavailable. */ }
  return "system";
}

let transitionFrame: number | undefined;

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  const dark = preference === "dark" || (preference === "system" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches));
  // Keep existing hover/focus transitions from interpolating mismatched palettes.
  // Two frames let the new colors paint before restoring ordinary interactions.
  if (root.classList.contains("dark") !== dark) {
    if (transitionFrame !== undefined) window.cancelAnimationFrame(transitionFrame);
    root.classList.add("theme-switching");
    transitionFrame = window.requestAnimationFrame(() => {
      transitionFrame = window.requestAnimationFrame(() => {
        root.classList.remove("theme-switching");
        transitionFrame = undefined;
      });
    });
  }
  root.classList.toggle("dark", dark);
  root.dataset.themePreference = preference;
  root.style.colorScheme = dark ? "dark" : "light";
}

export function getThemePreference(): ThemePreference {
  const value = document.documentElement.dataset.themePreference;
  return value === "light" || value === "dark" ? value : "system";
}

export function subscribeToTheme(onChange: () => void) {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const systemChanged = () => {
    if (getThemePreference() === "system") applyTheme("system");
    onChange();
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    applyTheme(storedPreference());
    onChange();
  };
  media?.addEventListener("change", systemChanged);
  window.addEventListener("storage", storageChanged);
  window.addEventListener("mindvault-theme-change", onChange);
  return () => {
    media?.removeEventListener("change", systemChanged);
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener("mindvault-theme-change", onChange);
  };
}

export function setThemePreference(preference: ThemePreference) {
  try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Keep the in-memory choice. */ }
  applyTheme(preference);
  window.dispatchEvent(new Event("mindvault-theme-change"));
}
