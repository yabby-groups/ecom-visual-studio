import {
  WindowSetDarkTheme,
  WindowSetLightTheme,
  WindowSetSystemDefaultTheme,
} from "../wailsjs/runtime/runtime";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const STORAGE_KEY = "ecom-theme";
const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

function storedPreference(): ThemePreference {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

let preference = storedPreference();

export function resolvedTheme(value = preference): ResolvedTheme {
  return value === "dark" || (value === "system" && media.matches)
    ? "dark"
    : "light";
}

function syncNativeTheme(value: ThemePreference) {
  try {
    if (!(window as Window & { runtime?: unknown }).runtime) return;
    if (value === "system") WindowSetSystemDefaultTheme();
    else if (value === "dark") WindowSetDarkTheme();
    else WindowSetLightTheme();
  } catch {
    // Vite/browser previews do not expose the Wails runtime.
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.style.colorScheme = resolvedTheme();
  syncNativeTheme(preference);
  listeners.forEach((listener) => listener());
}

export function getThemePreference() {
  return preference;
}

export function setThemePreference(value: ThemePreference) {
  preference = value;
  localStorage.setItem(STORAGE_KEY, value);
  applyTheme();
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

media.addEventListener("change", () => {
  if (preference === "system") applyTheme();
});

// Wails injects its runtime independently of the module graph. The first
// application of a stored light preference can happen before that bridge is
// ready, leaving the native window frame in the system's dark appearance.
window.addEventListener("wails:ready", () => syncNativeTheme(preference));

applyTheme();
