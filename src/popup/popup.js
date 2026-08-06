const status = document.getElementById("status");
const toggle = document.getElementById("toggle");
const options = document.getElementById("options");
const voiceStudio = document.getElementById("voiceStudio");

toggle.addEventListener("click", openVoiceStudio);
voiceStudio.addEventListener("click", openVoiceStudio);

options.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", async () => {
    const command = button.getAttribute("data-command");
    await sendToActiveTab({ type: "VOICE_COPILOT_RUN_TEXT_COMMAND", command });
    status.textContent = command;
  });
});

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    status.textContent = "No active tab";
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    status.textContent = "Reload page first";
  }
}

async function openVoiceStudio() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    status.textContent = "No target tab";
    return;
  }
  await chrome.runtime.sendMessage({ type: "VOICE_COPILOT_OPEN_VOICE_STUDIO", tabId: tab.id });
  status.textContent = "Opening AI voice";
}
