const DEFAULT_SETTINGS = {
  wakeWord: "hey browser",
  overlayEnabled: true,
  scrollSpeed: 650,
  voiceSensitivity: 0.75,
  autoConfirm: false,
  language: "en-US",
  theme: "system"
};

const KNOWN_SITES = new Map([
  ["youtube", "https://www.youtube.com"],
  ["google", "https://www.google.com"],
  ["gmail", "https://mail.google.com"],
  ["maps", "https://maps.google.com"],
  ["github", "https://github.com"],
  ["amazon", "https://www.amazon.com"],
  ["reddit", "https://www.reddit.com"],
  ["wikipedia", "https://www.wikipedia.org"]
]);

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...stored });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-voice-control") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "VOICE_COPILOT_TOGGLE" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "VOICE_COPILOT_OPEN_URL": {
      const url = normalizeDestination(message.destination);
      if (message.disposition === "new-tab") {
        await chrome.tabs.create({ url });
      } else if (sender.tab?.id) {
        await chrome.tabs.update(sender.tab.id, { url });
      }
      return { url };
    }
    case "VOICE_COPILOT_TAB_ACTION": {
      if (!sender.tab?.id) return null;
      if (message.action === "back") await chrome.tabs.goBack(sender.tab.id);
      if (message.action === "forward") await chrome.tabs.goForward(sender.tab.id);
      if (message.action === "reload") await chrome.tabs.reload(sender.tab.id);
      return { action: message.action };
    }
    case "VOICE_COPILOT_OPEN_VOICE_STUDIO": {
      const tabId = sender.tab?.id || message.tabId || await getActiveTabId();
      const url = chrome.runtime.getURL(`src/voice/voice.html?tabId=${encodeURIComponent(tabId || "")}`);
      await chrome.tabs.create({ url });
      return { url, tabId };
    }
    case "VOICE_COPILOT_RUN_COMMAND_IN_TAB": {
      const tabId = Number(message.tabId);
      const command = String(message.command || "").trim();
      if (!tabId || !command) throw new Error("Missing target tab or command");
      const response = await sendCommandToTab(tabId, command, {
        fromVoice: Boolean(message.fromVoice),
        wakeVerified: Boolean(message.wakeVerified)
      });
      return { tabId, command, response };
    }
    case "VOICE_COPILOT_GET_SETTINGS": {
      return chrome.storage.sync.get(DEFAULT_SETTINGS);
    }
    case "VOICE_COPILOT_SAVE_SETTINGS": {
      const safe = sanitizeSettings(message.settings || {});
      await chrome.storage.sync.set(safe);
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "VOICE_COPILOT_SETTINGS_CHANGED", settings: safe }).catch(() => {});
      }
      return safe;
    }
    default:
      return null;
  }
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

async function sendCommandToTab(tabId, command, options = {}) {
  const payload = {
    type: "VOICE_COPILOT_RUN_TEXT_COMMAND",
    command,
    fromVoice: Boolean(options.fromVoice),
    wakeVerified: Boolean(options.wakeVerified)
  };
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["src/content/content.js"]
    });
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

function sanitizeSettings(settings) {
  const next = {};
  if (typeof settings.wakeWord === "string") next.wakeWord = settings.wakeWord.trim().toLowerCase().slice(0, 40) || DEFAULT_SETTINGS.wakeWord;
  if (typeof settings.overlayEnabled === "boolean") next.overlayEnabled = settings.overlayEnabled;
  if (Number.isFinite(settings.scrollSpeed)) next.scrollSpeed = Math.min(2000, Math.max(100, Number(settings.scrollSpeed)));
  if (Number.isFinite(settings.voiceSensitivity)) next.voiceSensitivity = Math.min(1, Math.max(0, Number(settings.voiceSensitivity)));
  if (typeof settings.autoConfirm === "boolean") next.autoConfirm = settings.autoConfirm;
  if (typeof settings.language === "string") next.language = settings.language.slice(0, 20);
  if (["system", "light", "dark"].includes(settings.theme)) next.theme = settings.theme;
  return next;
}

function normalizeDestination(rawDestination = "") {
  const destination = String(rawDestination).trim().toLowerCase();
  if (!destination) return "chrome://newtab";

  if (KNOWN_SITES.has(destination)) return KNOWN_SITES.get(destination);
  if (/^https?:\/\//i.test(destination)) return destination;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(destination)) return `https://${destination}`;

  const compact = destination.replace(/\s+/g, "");
  if (KNOWN_SITES.has(compact)) return KNOWN_SITES.get(compact);

  return `https://www.google.com/search?q=${encodeURIComponent(destination)}`;
}
