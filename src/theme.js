const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function normalizeTheme(theme) {
  if (theme === "light" || theme === "dark" || theme === "system") return theme;
  return "system";
}

function getResolvedTheme(theme = "system") {
  const normalized = normalizeTheme(theme);
  if (normalized !== "system") return normalized;
  return themeMediaQuery.matches ? "dark" : "light";
}

function applyTheme(theme = "system") {
  const normalized = normalizeTheme(theme);
  const resolvedTheme = getResolvedTheme(normalized);
  document.documentElement.dataset.theme = normalized;
  document.documentElement.dataset.resolvedTheme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

function setupSystemThemeListener() {
  const callback = () => {
    if (document.documentElement.dataset.theme === "system") {
      applyTheme("system");
    }
  };

  if (typeof themeMediaQuery.addEventListener === "function") {
    themeMediaQuery.addEventListener("change", callback);
  } else if (typeof themeMediaQuery.addListener === "function") {
    themeMediaQuery.addListener(callback);
  }
}

window.applyTheme = applyTheme;
window.setupSystemThemeListener = setupSystemThemeListener;
