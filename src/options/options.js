const DEFAULT_SETTINGS = {
  wakeWord: "hey browser",
  overlayEnabled: true,
  scrollSpeed: 650,
  voiceSensitivity: 0.75,
  autoConfirm: false,
  language: "en-US",
  theme: "system"
};

const form = document.getElementById("settings-form");
const status = document.getElementById("status");
const scrollSpeedValue = document.getElementById("scrollSpeedValue");
const voiceSensitivityValue = document.getElementById("voiceSensitivityValue");

loadSettings();

form.addEventListener("input", updateOutputs);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = {
    wakeWord: form.wakeWord.value,
    language: form.language.value,
    overlayEnabled: form.overlayEnabled.checked,
    autoConfirm: form.autoConfirm.checked,
    scrollSpeed: Number(form.scrollSpeed.value),
    voiceSensitivity: Number(form.voiceSensitivity.value),
    theme: form.theme.value
  };

  const response = await chrome.runtime.sendMessage({ type: "VOICE_COPILOT_SAVE_SETTINGS", settings });
  status.textContent = response?.ok ? "Saved" : "Could not save";
  if (response?.ok) applyTheme(settings.theme);
  setTimeout(() => status.textContent = "", 2200);
});

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: "VOICE_COPILOT_GET_SETTINGS" });
  const settings = { ...DEFAULT_SETTINGS, ...(response?.result || {}) };
  form.wakeWord.value = settings.wakeWord;
  form.language.value = settings.language;
  form.overlayEnabled.checked = settings.overlayEnabled;
  form.autoConfirm.checked = settings.autoConfirm;
  form.scrollSpeed.value = settings.scrollSpeed;
  form.voiceSensitivity.value = settings.voiceSensitivity;
  form.theme.value = settings.theme;
  applyTheme(settings.theme);
  updateOutputs();
}

function updateOutputs() {
  scrollSpeedValue.textContent = `${form.scrollSpeed.value}px`;
  voiceSensitivityValue.textContent = `${Math.round(Number(form.voiceSensitivity.value) * 100)}%`;
}
