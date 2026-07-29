"use client";

import { useSyncExternalStore } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";

type Theme = "light" | "dark";

function subscribeToTheme(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
    attributes: true,
  });
  return () => observer.disconnect();
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

export function ThemeToggle({
  className = "access-theme-toggle",
}: Readonly<{ className?: string }>) {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const label = theme === "dark" ? "切换到浅色主题" : "切换到深色主题";

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("app-shell-theme", next);
    } catch {
      // The visible theme still changes when storage is unavailable.
    }
  };

  return (
    <button
      aria-label={label}
      className={className}
      title={label}
      type="button"
      onClick={toggleTheme}
    >
      <AppIcon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
