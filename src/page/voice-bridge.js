(() => {
  if (window.__browserVoiceCopilotBridgeLoaded) return;
  window.__browserVoiceCopilotBridgeLoaded = true;

  let recognition = null;
  let listening = false;

  document.addEventListener("BVC_START_LISTENING", () => {
    startListening(document.documentElement.getAttribute("data-bvc-language") || "en-US");
  });

  document.addEventListener("BVC_STOP_LISTENING", () => {
    stopListening();
  });

  document.addEventListener("click", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const clickedCopilot = path.some((node) => node?.nodeType === 1 && node.localName === "browser-voice-copilot");
    if (!clickedCopilot) return;

    if (listening) {
      stopListening();
    } else {
      startListening(document.documentElement.getAttribute("data-bvc-language") || "en-US");
    }
  }, true);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "BVC_CONTENT") return;

    if (event.data.type === "BVC_START_LISTENING") {
      startListening(event.data.language || "en-US");
    }

    if (event.data.type === "BVC_STOP_LISTENING") {
      stopListening();
    }
  });

  postToContent("BVC_BRIDGE_READY");

  function startListening(language) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      postToContent("BVC_VOICE_ERROR", { error: "SpeechRecognition is not available in this browser" });
      return;
    }

    if (listening) {
      postToContent("BVC_VOICE_STATUS", { status: "Already listening" });
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      listening = true;
      postToContent("BVC_VOICE_START");
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      const last = event.results[event.results.length - 1];

      postToContent("BVC_VOICE_TRANSCRIPT", {
        transcript,
        isFinal: Boolean(last?.isFinal)
      });
    };

    recognition.onerror = (event) => {
      listening = false;
      postToContent("BVC_VOICE_ERROR", { error: event.error || "unknown" });
    };

    recognition.onend = () => {
      listening = false;
      postToContent("BVC_VOICE_END");
    };

    try {
      recognition.start();
    } catch (error) {
      postToContent("BVC_VOICE_ERROR", { error: error?.message || "Could not start speech recognition" });
    }
  }

  function stopListening() {
    recognition?.stop();
    listening = false;
    postToContent("BVC_VOICE_END");
  }

  function postToContent(type, payload = {}) {
    window.postMessage({ source: "BVC_PAGE", type, ...payload }, "*");
  }
})();
