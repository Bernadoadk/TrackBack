import { useEffect, useState } from "react";
import { Icon } from "./ui";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "light" : "dark";
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("rf_theme", t); } catch { /* ignore */ }
}

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  if (!mounted) return null;

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="group relative w-10 h-10 rounded-full grid place-content-center
                 bg-surface border border-border
                 hover:border-accent2 hover:shadow-[0_0_0_4px_rgba(108,99,255,0.12)]
                 transition-all duration-300 ease-out"
    >
      {/* Sun icon (visible in dark mode → invitation to go light) */}
      <span
        className={`absolute inset-0 grid place-content-center transition-all duration-300 ${
          isDark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-75"
        }`}
        style={{ color: "#F59E0B" }}
      >
        <Icon name="Sun" size={17} strokeWidth={2.25} />
      </span>
      {/* Moon icon (visible in light mode → invitation to go dark) */}
      <span
        className={`absolute inset-0 grid place-content-center transition-all duration-300 ${
          isDark ? "opacity-0 rotate-90 scale-75" : "opacity-100 rotate-0 scale-100"
        }`}
        style={{ color: "#6C63FF" }}
      >
        <Icon name="Moon" size={16} strokeWidth={2.25} />
      </span>
    </button>
  );
}
