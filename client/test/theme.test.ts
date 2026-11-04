import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { getThemePreference, setThemePreference, subscribeToTheme, THEME_STORAGE_KEY, themeInitializationScript } from "@/lib/theme";

let dom: JSDOM;
let originalGlobals: Record<string, PropertyDescriptor | undefined>;
let prefersDark: boolean;
let reducedMotion: boolean;
let mediaListeners: Set<() => void>;
let unsubscribe: (() => void) | undefined;
let animationFrames: Map<number, FrameRequestCallback>;

function paintFrame() {
  const callbacks = [...animationFrames.values()];
  animationFrames.clear();
  for (const callback of callbacks) callback(0);
}

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost", runScripts: "outside-only" });
  prefersDark = false;
  reducedMotion = false;
  mediaListeners = new Set();
  animationFrames = new Map();
  let nextFrame = 0;
  dom.window.requestAnimationFrame = callback => {
    animationFrames.set(++nextFrame, callback);
    return nextFrame;
  };
  dom.window.cancelAnimationFrame = frame => { animationFrames.delete(frame); };
  Object.defineProperty(dom.window, "matchMedia", { value: (query: string) => ({
    get matches() { return query.includes("reduced-motion") ? reducedMotion : prefersDark; },
    addEventListener: (_name: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => mediaListeners.delete(listener),
  }) });
  originalGlobals = {};
  const replacements = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, Event: dom.window.Event };
  for (const [key, value] of Object.entries(replacements)) {
    originalGlobals[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  paintFrame();
  paintFrame();
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
});

test("the pre-paint script restores a saved theme before hydration and follows system by default", () => {
  prefersDark = true;
  dom.window.eval(themeInitializationScript);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(getThemePreference()).toBe("system");
  localStorage.setItem(THEME_STORAGE_KEY, "light");
  dom.window.eval(themeInitializationScript);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(getThemePreference()).toBe("light");
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  prefersDark = false;
  dom.window.eval(themeInitializationScript);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

test("switching saves the preference and keeps automatic system changes from overriding it", () => {
  unsubscribe = subscribeToTheme(() => {});
  setThemePreference("dark");
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  expect(getThemePreference()).toBe("dark");
  expect(document.documentElement.classList.contains("theme-switching")).toBe(true);
  for (const listener of mediaListeners) listener();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  setThemePreference("system");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  prefersDark = true;
  for (const listener of mediaListeners) listener();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

test("storage changes sync another tab and reduced motion changes the palette immediately", () => {
  unsubscribe = subscribeToTheme(() => {});
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  window.dispatchEvent(new dom.window.StorageEvent("storage", { key: THEME_STORAGE_KEY }));
  expect(getThemePreference()).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  reducedMotion = true;
  setThemePreference("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
  paintFrame();
  paintFrame();
  expect(document.documentElement.classList.contains("theme-switching")).toBe(false);
});

test("rapid switches paint the final palette without a layout read or lingering transition suppression", () => {
  Object.defineProperty(document.documentElement, "offsetWidth", { get() { throw new Error("Forced layout"); } });
  setThemePreference("dark");
  paintFrame();
  setThemePreference("light");
  setThemePreference("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(animationFrames.size).toBe(1);
  paintFrame();
  expect(document.documentElement.classList.contains("theme-switching")).toBe(true);
  paintFrame();
  expect(document.documentElement.classList.contains("theme-switching")).toBe(false);
  expect(animationFrames.size).toBe(0);
});

test("blocked storage does not prevent initialization or switching", () => {
  Object.defineProperty(dom.window, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
  prefersDark = true;
  expect(() => dom.window.eval(themeInitializationScript)).not.toThrow();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(() => setThemePreference("light")).not.toThrow();
  expect(getThemePreference()).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});
