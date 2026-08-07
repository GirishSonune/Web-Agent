setupSystemThemeListener();
applyTheme("system");

if (chrome?.runtime?.sendMessage) {
  chrome.runtime.sendMessage({ type: "VOICE_COPILOT_GET_SETTINGS" }, (response) => {
    const theme = response?.result?.theme || "system";
    applyTheme(theme);
  });
}
