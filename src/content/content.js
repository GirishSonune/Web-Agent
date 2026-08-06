(() => {
  if (window.__browserVoiceCopilotLoaded) return;
  window.__browserVoiceCopilotLoaded = true;

  const DEFAULT_SETTINGS = {
    wakeWord: "hey browser",
    overlayEnabled: true,
    scrollSpeed: 650,
    voiceSensitivity: 0.75,
    autoConfirm: false,
    language: "en-US",
    theme: "system"
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    recognition: null,
    listening: false,
    transcript: "",
    pendingCommand: null,
    lastAction: null,
    candidates: [],
    lastTargetText: "",
    overlay: null,
    voiceBridgeReady: false,
    voiceBridgeInjected: false
  };

  boot();

  async function boot() {
    state.settings = await getSettings();
    if (isTopFrame()) {
      createOverlay();
      injectVoiceBridge();
      wireVoiceBridge();
    }
    wireMessages();
  }

  function wireMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "VOICE_COPILOT_TOGGLE") {
        toggleListening();
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "VOICE_COPILOT_RUN_TEXT_COMMAND") {
        handleTranscript(message.command, {
          fromVoice: Boolean(message.fromVoice),
          wakeVerified: Boolean(message.wakeVerified)
        })
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
        return true;
      }
      if (message?.type === "VOICE_COPILOT_SETTINGS_CHANGED") {
        state.settings = { ...state.settings, ...message.settings };
        updateOverlay();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }

  async function getSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "VOICE_COPILOT_GET_SETTINGS" });
      return { ...DEFAULT_SETTINGS, ...(response?.result || {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function isTopFrame() {
    return window.top === window;
  }

  function createOverlay() {
    if (state.overlay || !state.settings.overlayEnabled) return;

    const host = document.createElement("browser-voice-copilot");
    host.setAttribute("aria-hidden", "false");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .bvc-panel {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          display: grid;
          gap: 8px;
          width: min(320px, calc(100vw - 32px));
          color: #101318;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
        }
        .bvc-widget {
          justify-self: end;
          display: grid;
          grid-template-columns: 44px 1fr;
          align-items: center;
          gap: 10px;
          width: 230px;
          min-height: 58px;
          padding: 7px 12px 7px 7px;
          border: 1px solid rgba(17, 24, 39, 0.16);
          border-radius: 8px;
          background: color-mix(in srgb, Canvas 92%, transparent);
          box-shadow: 0 14px 42px rgba(15, 23, 42, 0.20);
          backdrop-filter: blur(14px);
          pointer-events: auto;
        }
        .bvc-button {
          width: 44px;
          height: 44px;
          border: 0;
          border-radius: 8px;
          color: white;
          background: #1769e0;
          cursor: pointer;
          display: grid;
          place-items: center;
          transition: transform 160ms ease, background 160ms ease;
        }
        .bvc-button:hover { transform: translateY(-1px); }
        .bvc-button[aria-pressed="true"] { background: #d12c4a; }
        .bvc-icon { width: 20px; height: 20px; }
        .bvc-copy { min-width: 0; }
        .bvc-title {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bvc-status {
          margin-top: 3px;
          color: #4b5563;
          font-size: 12px;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }
        .bvc-wave {
          display: none;
          align-items: end;
          gap: 3px;
          height: 16px;
          margin-top: 5px;
        }
        .bvc-wave span {
          width: 4px;
          height: 5px;
          border-radius: 999px;
          background: #1769e0;
          animation: bvc-wave 760ms ease-in-out infinite;
        }
        .bvc-wave span:nth-child(2) { animation-delay: 90ms; }
        .bvc-wave span:nth-child(3) { animation-delay: 180ms; }
        .bvc-wave span:nth-child(4) { animation-delay: 270ms; }
        .bvc-listening .bvc-wave { display: flex; }
        .bvc-candidates {
          display: grid;
          gap: 6px;
          max-height: 260px;
          overflow: auto;
          padding: 8px;
          border: 1px solid rgba(17, 24, 39, 0.12);
          border-radius: 8px;
          background: color-mix(in srgb, Canvas 94%, transparent);
          box-shadow: 0 14px 42px rgba(15, 23, 42, 0.16);
          pointer-events: auto;
        }
        .bvc-candidate {
          display: grid;
          grid-template-columns: 24px 1fr;
          gap: 8px;
          align-items: center;
          min-height: 32px;
          color: #111827;
          font-size: 12px;
          line-height: 1.25;
        }
        .bvc-number {
          display: grid;
          place-items: center;
          width: 24px;
          height: 24px;
          border-radius: 7px;
          color: white;
          background: #1769e0;
          font-weight: 800;
        }
        .bvc-element-badge {
          position: fixed;
          z-index: 2147483646;
          display: grid;
          place-items: center;
          width: 24px;
          height: 24px;
          border-radius: 7px;
          color: white;
          background: #1769e0;
          font: 800 12px/1 Inter, system-ui, sans-serif;
          box-shadow: 0 8px 20px rgba(23, 105, 224, 0.35);
          pointer-events: none;
        }
        .bvc-element-ring {
          position: fixed;
          z-index: 2147483645;
          border: 2px solid #1769e0;
          border-radius: 6px;
          box-shadow: 0 0 0 3px rgba(23, 105, 224, 0.16);
          pointer-events: none;
        }
        @media (prefers-color-scheme: dark) {
          .bvc-widget, .bvc-candidates {
            color: #f8fafc;
            background: rgba(16, 18, 24, 0.88);
            border-color: rgba(255, 255, 255, 0.14);
          }
          .bvc-status { color: #cbd5e1; }
          .bvc-candidate { color: #f8fafc; }
        }
        @keyframes bvc-wave {
          0%, 100% { height: 5px; opacity: 0.55; }
          50% { height: 16px; opacity: 1; }
        }
      </style>
      <div class="bvc-panel">
        <div class="bvc-widget" part="widget">
          <button class="bvc-button" type="button" aria-label="Toggle voice control" aria-pressed="false">
            <svg class="bvc-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" stroke="currentColor" stroke-width="2"/>
              <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3M8 21h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
          <div class="bvc-copy">
            <div class="bvc-title">Voice Copilot</div>
            <div class="bvc-status">Press Ctrl+Shift+Y or tap mic</div>
            <div class="bvc-wave" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          </div>
        </div>
        <div class="bvc-candidates" hidden></div>
      </div>
    `;
    document.documentElement.appendChild(host);

    const refs = {
      host,
      shadow,
      panel: shadow.querySelector(".bvc-panel"),
      widget: shadow.querySelector(".bvc-widget"),
      button: shadow.querySelector(".bvc-button"),
      status: shadow.querySelector(".bvc-status"),
      candidates: shadow.querySelector(".bvc-candidates"),
      marks: []
    };
    refs.button.addEventListener("click", toggleListening);
    state.overlay = refs;
    updateOverlay();
  }

  function destroyOverlay() {
    clearHighlights();
    state.overlay?.host.remove();
    state.overlay = null;
  }

  function updateOverlay(message) {
    if (!isTopFrame()) return;
    if (!state.settings.overlayEnabled) {
      destroyOverlay();
      return;
    }
    if (!state.overlay) createOverlay();
    if (!state.overlay) return;

    state.overlay.widget.classList.toggle("bvc-listening", state.listening);
    state.overlay.button.setAttribute("aria-pressed", String(state.listening));
    state.overlay.status.textContent = message || (state.listening ? "Listening..." : "Press Ctrl+Shift+Y or tap mic");
  }

  function toggleListening() {
    if (state.listening) stopListening();
    else startListening();
  }

  function startListening() {
    if (isTopFrame()) {
      injectVoiceBridge();
      document.documentElement.setAttribute("data-bvc-language", state.settings.language);
      document.dispatchEvent(new Event("BVC_START_LISTENING"));
      updateOverlay("Listening...");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      updateOverlay("Speech recognition is unavailable in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = state.settings.language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      state.listening = true;
      state.transcript = "";
      updateOverlay("Listening...");
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      state.transcript = transcript;
      updateOverlay(transcript || "Listening...");
      const last = event.results[event.results.length - 1];
      if (last?.isFinal) handleTranscript(transcript, { fromVoice: true, wakeVerified: true });
    };
    recognition.onerror = (event) => {
      state.listening = false;
      updateOverlay(`Voice error: ${event.error}`);
    };
    recognition.onend = () => {
      state.listening = false;
      updateOverlay(state.transcript ? `Heard: ${state.transcript}` : undefined);
    };

    state.recognition = recognition;
    try {
      recognition.start();
    } catch {
      updateOverlay("Already listening");
    }
  }

  function stopListening() {
    if (isTopFrame()) {
      document.dispatchEvent(new CustomEvent("BVC_STOP_LISTENING"));
    }
    state.recognition?.stop();
    state.listening = false;
    updateOverlay();
  }

  function injectVoiceBridge() {
    if (state.voiceBridgeInjected || !isTopFrame()) return;
    state.voiceBridgeInjected = true;

    const existing = document.getElementById("browser-voice-copilot-bridge");
    if (existing) return;

    const script = document.createElement("script");
    script.id = "browser-voice-copilot-bridge";
    script.src = chrome.runtime.getURL("src/page/voice-bridge.js");
    script.async = false;
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  function wireVoiceBridge() {
    window.addEventListener("message", async (event) => {
      if (event.source !== window || !event.data || event.data.source !== "BVC_PAGE") return;

      if (event.data.type === "BVC_BRIDGE_READY") {
        state.voiceBridgeReady = true;
        return;
      }

      if (event.data.type === "BVC_VOICE_START") {
        state.listening = true;
        state.transcript = "";
        updateOverlay("Listening...");
        return;
      }

      if (event.data.type === "BVC_VOICE_TRANSCRIPT") {
        const transcript = event.data.transcript || "";
        state.transcript = transcript;
        updateOverlay(transcript || "Listening...");
        if (event.data.isFinal && transcript) await handleTranscript(transcript, { fromVoice: true, wakeVerified: true });
        return;
      }

      if (event.data.type === "BVC_VOICE_ERROR") {
        state.listening = false;
        updateOverlay(formatVoiceError(event.data.error));
        return;
      }

      if (event.data.type === "BVC_VOICE_END") {
        state.listening = false;
        updateOverlay(state.transcript ? `Heard: ${state.transcript}` : undefined);
      }
    });
  }

  function formatVoiceError(error) {
    const value = String(error || "unknown");
    if (value === "not-allowed") return "Microphone blocked. Allow mic for this site.";
    if (value === "no-speech") return "No speech heard. Try again.";
    if (value === "audio-capture") return "No microphone found.";
    if (value === "network") return "Speech service network error.";
    return `Voice error: ${value}`;
  }

  async function handleTranscript(rawTranscript, options = {}) {
    const normalized = normalizeTranscript(rawTranscript);
    if (options.fromVoice && !options.wakeVerified && !normalized.wakeDetected) {
      updateOverlay(`Say "${state.settings.wakeWord}" before a voice command`);
      return { executed: false, reason: "wake-word-missing" };
    }

    const transcript = normalized.text;
    if (!transcript) return { executed: false, reason: "empty-command" };

    const command = parseIntent(transcript, state);
    if (!command) {
      updateOverlay("I did not understand. Try: click login, scroll down, type shoes in search");
      return { executed: false, reason: "not-understood", transcript };
    }

    if (command.type === "confirm" && state.pendingCommand) {
      const pending = state.pendingCommand;
      state.pendingCommand = null;
      await executeCommand(pending, { confirmed: true });
      return { executed: true, type: pending.type, transcript };
    }

    if (command.type === "cancel") {
      state.pendingCommand = null;
      clearHighlights();
      updateOverlay("Cancelled");
      return { executed: true, type: "cancel", transcript };
    }

    if (command.type === "undo") {
      await undoLastAction();
      return { executed: true, type: "undo", transcript };
    }

    if (command.type === "selectCandidate") {
      const candidate = state.candidates[command.index - 1];
      if (!candidate) {
        updateOverlay(`No option ${command.index}`);
        return { executed: false, reason: "candidate-not-found", transcript };
      }
      if (candidate.pendingText) {
        const previousValue = "value" in candidate.element ? candidate.element.value : candidate.element.textContent;
        typeIntoElement(candidate.element, candidate.pendingText);
        rememberAction({ type: "type", element: candidate.element, previousValue });
        updateOverlay(`Typed "${candidate.pendingText}"`);
      } else {
        await clickElement(candidate.element);
        rememberAction({ type: "click", element: candidate.element });
        updateOverlay(`Clicked ${candidate.label}`);
      }
      clearHighlights();
      return { executed: true, type: "selectCandidate", transcript };
    }

    if (requiresConfirmation(command) && !state.settings.autoConfirm) {
      state.pendingCommand = command;
      updateOverlay(`Say "confirm" to ${command.type} ${command.target || ""}`.trim());
      return { executed: false, reason: "confirmation-required", type: command.type, transcript };
    }

    await executeCommand(command, { confirmed: false });
    return { executed: true, type: command.type, transcript };
  }

  function normalizeTranscript(rawTranscript) {
    let text = String(rawTranscript || "")
      .toLowerCase()
      .replace(/[.,!?]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wakeWord = String(state.settings.wakeWord || DEFAULT_SETTINGS.wakeWord)
      .toLowerCase()
      .replace(/[.,!?]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wakeDetected = text === wakeWord || text.startsWith(`${wakeWord} `);
    if (wakeDetected) text = text.slice(wakeWord.length).trim();
    return { text, wakeDetected };
  }

  function parseIntent(text, currentState) {
    if (/^(cancel|stop|nevermind|never mind)$/.test(text)) return { type: "cancel" };
    if (/^(confirm|yes|do it|proceed)$/.test(text)) return { type: "confirm" };
    if (/^(undo|go back one step)$/.test(text)) return { type: "undo" };
    if (/^(try again|retry)$/.test(text)) return currentState.pendingCommand || null;

    const selectionIndex = parseSelectionIndex(text, currentState.candidates.length);
    if (selectionIndex) return { type: "selectCandidate", index: selectionIndex };

    if (/^(?:enter|enter key|press enter|press the enter key|hit enter|hit the enter key|click enter|tap enter|submit|submit form)$/.test(text)) {
      return { type: "key", key: "Enter" };
    }

    if (/^scroll (down|up|left|right)$/.test(text)) {
      return { type: "scroll", direction: text.split(" ")[1], amount: "normal" };
    }
    if (/^(page down|page up)$/.test(text)) {
      return { type: "scroll", direction: text.endsWith("down") ? "down" : "up", amount: "page" };
    }
    if (/^(go|navigate) back$/.test(text)) return { type: "tab", action: "back" };
    if (/^(go|navigate) forward$/.test(text)) return { type: "tab", action: "forward" };
    if (/^(refresh|reload)( page)?$/.test(text)) return { type: "tab", action: "reload" };

    const openMatch = text.match(/^(?:open|go to|navigate to)\s+(.+?)(?:\s+in a new tab)?$/);
    if (openMatch) {
      return {
        type: "open",
        destination: openMatch[1],
        disposition: /\bnew tab\b/.test(text) ? "new-tab" : "current-tab"
      };
    }

    const clickMatch = text.match(/^(?:click|press|tap|open)\s+(.+)$/);
    if (clickMatch) return { type: "click", target: cleanTarget(clickMatch[1]) };

    const typeMatch = text.match(/^(?:type|enter|write|search for)\s+(.+?)(?:\s+(?:in|into|on)\s+(.+))?$/);
    if (typeMatch) {
      return {
        type: "type",
        text: typeMatch[1].trim(),
        target: cleanTarget(typeMatch[2] || "focused input")
      };
    }

    return null;
  }

  function cleanTarget(text) {
    return String(text || "").replace(/^(the|a|an)\s+/, "").trim();
  }

  function parseSelectionIndex(text, candidateCount) {
    const ordinals = new Map([
      ["one", 1],
      ["first", 1],
      ["two", 2],
      ["second", 2],
      ["to", 2],
      ["too", 2],
      ["three", 3],
      ["third", 3],
      ["four", 4],
      ["fourth", 4],
      ["for", 4],
      ["five", 5],
      ["fifth", 5],
      ["six", 6],
      ["sixth", 6],
      ["seven", 7],
      ["seventh", 7],
      ["eight", 8],
      ["eighth", 8],
      ["nine", 9],
      ["ninth", 9],
      ["ten", 10],
      ["tenth", 10]
    ]);

    const explicit = text.match(/^(?:number|option|choose|select|pick|open|click|tap)\s+(?:the\s+)?(\d{1,2}|[a-z]+)(?:\s+(?:option|result|item|one))?$/);
    const bare = candidateCount > 0 ? text.match(/^(\d{1,2}|[a-z]+)$/) : null;
    const value = explicit?.[1] || bare?.[1];
    if (!value) return null;

    const index = /^\d+$/.test(value) ? Number(value) : ordinals.get(value);
    if (!index || index < 1) return null;
    if (candidateCount > 0 && index > candidateCount) return null;
    return index;
  }

  async function executeCommand(command) {
    switch (command.type) {
      case "scroll":
        executeScroll(command);
        rememberAction({ type: "scroll", x: window.scrollX, y: window.scrollY });
        break;
      case "tab":
        await chrome.runtime.sendMessage({ type: "VOICE_COPILOT_TAB_ACTION", action: command.action });
        rememberAction({ type: "tab", action: command.action });
        updateOverlay(`${command.action} requested`);
        break;
      case "open":
        await chrome.runtime.sendMessage({
          type: "VOICE_COPILOT_OPEN_URL",
          destination: command.destination,
          disposition: command.disposition
        });
        rememberAction({ type: "open" });
        updateOverlay(`Opening ${command.destination}`);
        break;
      case "click":
        await executeClick(command.target);
        break;
      case "type":
        await executeType(command);
        break;
      case "key":
        await executeKey(command);
        break;
      default:
        updateOverlay("Unsupported command");
    }
  }

  function executeScroll(command) {
    const base = command.amount === "page" ? Math.round(window.innerHeight * 0.86) : state.settings.scrollSpeed;
    const delta = command.direction === "up" || command.direction === "left" ? -base : base;
    const options = command.direction === "left" || command.direction === "right" ? { left: delta } : { top: delta };
    window.scrollBy({ ...options, behavior: "smooth" });
    updateOverlay(`Scrolling ${command.direction}`);
  }

  async function executeClick(targetText) {
    const matches = findInteractiveElements(targetText).slice(0, 8);
    if (matches.length === 0) {
      updateOverlay(`Could not find "${targetText}"`);
      return;
    }

    state.candidates = matches;
    if (matches.length > 1 && matches[0].score - matches[1].score < 18) {
      showCandidates(matches);
      updateOverlay(`Which ${targetText}? Say number 1-${matches.length}`);
      return;
    }

    await clickElement(matches[0].element);
    rememberAction({ type: "click", element: matches[0].element });
    clearHighlights();
    updateOverlay(`Clicked ${matches[0].label}`);
  }

  async function executeType(command) {
    const active = getEditableTarget(document.activeElement) ? document.activeElement : null;
    const matches = command.target === "focused input" && active
      ? [{ element: active, label: "focused input", score: 100 }]
      : findEditableElements(command.target).slice(0, 6);

    if (matches.length === 0) {
      updateOverlay(`Could not find an input for "${command.target}"`);
      return;
    }

    if (matches.length > 1 && matches[0].score - matches[1].score < 16) {
      state.candidates = matches.map((match) => ({ ...match, pendingText: command.text }));
      showCandidates(matches);
      updateOverlay(`Which field? Say number 1-${matches.length}`);
      return;
    }

    typeIntoElement(matches[0].element, command.text);
    rememberAction({ type: "type", element: matches[0].element, previousValue: matches[0].previousValue || "" });
    clearHighlights();
    updateOverlay(`Typed "${command.text}"`);
  }

  async function executeKey(command) {
    if (command.key !== "Enter") {
      updateOverlay(`Unsupported key: ${command.key}`);
      return;
    }

    const target = getEnterTarget();

    target.focus?.({ preventScroll: true });
    dispatchEnterKey(target);
    await submitAfterEnter(target);

    rememberAction({ type: "key", key: "Enter", element: target });
    updateOverlay("Pressed Enter");
  }

  function getEnterTarget() {
    if (state.lastAction?.type === "type" && state.lastAction.element && document.contains(state.lastAction.element)) {
      return state.lastAction.element;
    }

    if (getEditableTarget(document.activeElement)) {
      return document.activeElement;
    }

    return findEditableElements("focused input")[0]?.element || document.activeElement || document.body;
  }

  function dispatchEnterKey(element) {
    const options = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    const keydownAllowed = element.dispatchEvent(new KeyboardEvent("keydown", options));
    element.dispatchEvent(new KeyboardEvent("keypress", options));
    element.dispatchEvent(new KeyboardEvent("keyup", options));
    return keydownAllowed;
  }

  async function submitAfterEnter(element) {
    const tag = element?.tagName;
    if (tag === "TEXTAREA" || element?.isContentEditable) return;

    const type = String(element.type || "").toLowerCase();
    if (!["", "text", "search", "email", "url", "tel", "number"].includes(type)) return;

    element.dispatchEvent(new Event("change", { bubbles: true }));

    if (element.form) {
      const submitter = findSubmitter(element.form);
      try {
        if (element.form.requestSubmit) {
          element.form.requestSubmit(submitter || undefined);
        } else if (submitter) {
          await clickElement(submitter);
        } else {
          element.form.submit();
        }
        return;
      } catch {
        if (submitter) {
          await clickElement(submitter);
          return;
        }
      }
    }

    const fallback = findInteractiveElements("search")[0] || findInteractiveElements("submit")[0] || findInteractiveElements("go")[0];
    if (fallback?.element) await clickElement(fallback.element);
  }

  function findSubmitter(form) {
    const candidates = Array.from(form.querySelectorAll([
      "button:not([disabled])",
      "input[type='submit']:not([disabled])",
      "input[type='button']:not([disabled])",
      "[role='button']:not([aria-disabled='true'])"
    ].join(",")));

    return candidates.find((element) => {
      const type = String(element.getAttribute("type") || "").toLowerCase();
      const label = normalizeLabel(getElementLabel(element));
      return type === "submit" || /\b(search|submit|go|send|enter)\b/.test(label);
    }) || null;
  }

  function findInteractiveElements(query) {
    const elements = Array.from(document.querySelectorAll([
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='checkbox']",
      "[role='radio']",
      "[contenteditable='true']"
    ].join(",")));

    return rankElements(elements, query, false);
  }

  function findEditableElements(query) {
    const elements = Array.from(document.querySelectorAll([
      "input:not([type='hidden']):not([type='password'])",
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']"
    ].join(",")));

    return rankElements(elements, query, true).map((match) => ({
      ...match,
      previousValue: "value" in match.element ? match.element.value : match.element.textContent
    }));
  }

  function rankElements(elements, query, editableOnly) {
    const normalizedQuery = normalizeLabel(query);
    return elements
      .filter((element) => isVisible(element) && !isProtectedField(element) && (!editableOnly || getEditableTarget(element)))
      .map((element) => {
        const label = getElementLabel(element);
        return { element, label, score: scoreLabel(label, normalizedQuery, element) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function getElementLabel(element) {
    const pieces = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("title"),
      element.getAttribute("alt"),
      element.labels ? Array.from(element.labels).map((label) => label.innerText).join(" ") : "",
      element.innerText,
      element.value && element.tagName !== "INPUT" ? element.value : ""
    ];
    return pieces.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 120) || element.tagName.toLowerCase();
  }

  function normalizeLabel(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(button|link|field|input|box|bar)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreLabel(label, query, element) {
    const normalized = normalizeLabel(label);
    if (!query || query === "focused") return getEditableTarget(element) ? 80 : 1;
    if (normalized === query) return 100;
    if (normalized.includes(query)) return 82;
    if (query.includes(normalized) && normalized.length > 2) return 70;

    const queryTokens = query.split(" ").filter(Boolean);
    const labelTokens = new Set(normalized.split(" ").filter(Boolean));
    const overlap = queryTokens.filter((token) => labelTokens.has(token)).length;
    if (overlap) return 30 + overlap * 12;

    if (element.id && normalizeLabel(element.id).includes(query)) return 58;
    if (element.name && normalizeLabel(element.name).includes(query)) return 54;
    return 0;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 1 &&
      rect.height > 1 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity) > 0.05 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
  }

  function isProtectedField(element) {
    const type = String(element.getAttribute("type") || "").toLowerCase();
    const autocomplete = String(element.getAttribute("autocomplete") || "").toLowerCase();
    const name = `${element.name || ""} ${element.id || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
    return type === "password" ||
      autocomplete.includes("cc-") ||
      /\b(card|credit|cvv|cvc|password|passcode|otp|pin)\b/.test(name);
  }

  function getEditableTarget(element) {
    if (!element || isProtectedField(element)) return null;
    const tag = element.tagName;
    if (tag === "TEXTAREA") return element;
    if (tag === "INPUT" && !["button", "submit", "reset", "checkbox", "radio", "file", "hidden", "password"].includes(String(element.type).toLowerCase())) return element;
    if (element.isContentEditable || element.getAttribute("role") === "textbox") return element;
    return null;
  }

  async function clickElement(element) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    await delay(180);
    highlightElements([{ element, label: getElementLabel(element) }]);
    await delay(180);
    element.focus?.({ preventScroll: true });
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    element.dispatchEvent(new MouseEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.dispatchEvent(new MouseEvent("click", options));
  }

  function typeIntoElement(element, text) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    element.focus({ preventScroll: true });

    if ("value" in element) {
      const prototype = Object.getPrototypeOf(element);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor?.set ? descriptor.set.call(element, text) : element.value = text;
    } else {
      element.textContent = text;
    }

    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function showCandidates(matches) {
    highlightElements(matches);
    state.candidates = matches;
    if (!state.overlay) return;
    state.overlay.candidates.hidden = false;
    state.overlay.candidates.innerHTML = matches
      .map((match, index) => `
        <div class="bvc-candidate">
          <span class="bvc-number">${index + 1}</span>
          <span>${escapeHtml(match.label)}</span>
        </div>
      `)
      .join("");
  }

  function highlightElements(matches) {
    clearHighlights();
    if (!state.overlay) return;

    for (const [index, match] of matches.entries()) {
      const rect = match.element.getBoundingClientRect();
      const ring = document.createElement("div");
      ring.className = "bvc-element-ring";
      ring.style.left = `${Math.max(0, rect.left)}px`;
      ring.style.top = `${Math.max(0, rect.top)}px`;
      ring.style.width = `${rect.width}px`;
      ring.style.height = `${rect.height}px`;

      const badge = document.createElement("div");
      badge.className = "bvc-element-badge";
      badge.textContent = String(index + 1);
      badge.style.left = `${Math.max(4, rect.left - 8)}px`;
      badge.style.top = `${Math.max(4, rect.top - 8)}px`;

      state.overlay.shadow.appendChild(ring);
      state.overlay.shadow.appendChild(badge);
      state.overlay.marks.push(ring, badge);
    }
  }

  function clearHighlights() {
    if (state.overlay?.candidates) {
      state.overlay.candidates.hidden = true;
      state.overlay.candidates.innerHTML = "";
    }
    for (const mark of state.overlay?.marks || []) mark.remove();
    if (state.overlay) state.overlay.marks = [];
    state.candidates = [];
  }

  function requiresConfirmation(command) {
    const text = `${command.target || ""} ${command.destination || ""}`.toLowerCase();
    if (command.type === "open" && command.disposition === "new-tab") return false;
    return /\b(delete|remove|purchase|buy|pay|checkout|submit|send|transfer|logout|log out|confirm)\b/.test(text);
  }

  async function undoLastAction() {
    const action = state.lastAction;
    if (!action) {
      updateOverlay("Nothing to undo");
      return;
    }
    if (action.type === "scroll") {
      window.scrollTo({ left: action.x, top: action.y, behavior: "smooth" });
      updateOverlay("Undid scroll");
      return;
    }
    if (action.type === "type" && action.element && document.contains(action.element)) {
      typeIntoElement(action.element, action.previousValue || "");
      updateOverlay("Undid typing");
      return;
    }
    updateOverlay("That action cannot be undone safely");
  }

  function rememberAction(action) {
    state.lastAction = action;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
