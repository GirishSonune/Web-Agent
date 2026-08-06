import { env, pipeline } from "../../node_modules/@huggingface/transformers/dist/transformers.web.js";

const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_MODEL = "onnx-community/whisper-tiny.en";

const params = new URLSearchParams(location.search);
const targetTabId = Number(params.get("tabId"));

const elements = {
  record: document.getElementById("record"),
  recordLabel: document.getElementById("recordLabel"),
  sendLast: document.getElementById("sendLast"),
  model: document.getElementById("model"),
  device: document.getElementById("device"),
  dtype: document.getElementById("dtype"),
  language: document.getElementById("language"),
  status: document.getElementById("status"),
  transcript: document.getElementById("transcript"),
  progressBar: document.getElementById("progressBar"),
  hardware: document.getElementById("hardware")
};

const state = {
  mediaRecorder: null,
  chunks: [],
  transcriber: null,
  transcriberKey: "",
  lastTranscript: "",
  recording: false
};

configureTransformers();
detectHardware();

elements.record.addEventListener("click", async () => {
  if (state.recording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

elements.sendLast.addEventListener("click", async () => {
  await sendCommand(elements.transcript.value.trim());
});

for (const element of [elements.model, elements.device, elements.dtype]) {
  element.addEventListener("change", () => {
    state.transcriber = null;
    state.transcriberKey = "";
    setProgress(0);
  });
}

async function startRecording() {
  if (!targetTabId) {
    setStatus("Missing target tab. Open AI voice control from the extension popup on the page you want to control.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    state.chunks = [];
    const mimeType = chooseMimeType();
    const recorderOptions = mimeType ? { mimeType } : undefined;
    state.mediaRecorder = new MediaRecorder(stream, recorderOptions);
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) state.chunks.push(event.data);
    };
    state.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      await transcribeAndSend();
    };

    state.mediaRecorder.start();
    state.recording = true;
    elements.record.setAttribute("aria-pressed", "true");
    elements.recordLabel.textContent = "Stop and transcribe";
    setStatus("Recording... click again when you finish speaking.");
  } catch (error) {
    setStatus(`Microphone error: ${formatError(error)}`);
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") return;
  state.mediaRecorder.stop();
  state.recording = false;
  elements.record.setAttribute("aria-pressed", "false");
  elements.recordLabel.textContent = "Hold to record";
  setStatus("Preparing audio...");
}

async function transcribeAndSend() {
  try {
    const blob = new Blob(state.chunks, { type: state.chunks[0]?.type || "audio/webm" });
    const audio = await decodeTo16kMono(blob);
    if (audio.length < TARGET_SAMPLE_RATE * 0.2) {
      setStatus("Audio was too short. Try again.");
      return;
    }

    const transcriber = await getTranscriber();
    setStatus("Transcribing locally...");
    setProgress(0);

    const output = await transcriber(audio, {
      language: elements.language.value.trim() || "english",
      task: "transcribe"
    });

    const text = String(output?.text || "").trim();
    state.lastTranscript = text;
    elements.transcript.value = text;
    elements.sendLast.disabled = !text;

    if (!text) {
      setStatus("No speech recognized. Try recording closer to the microphone.");
      return;
    }

    setStatus(`Recognized: ${text}`);
    await sendCommand(text);
  } catch (error) {
    setStatus(`ASR error: ${formatError(error)}`);
    if (elements.dtype.value === "q4") {
      setStatus("q4 failed for this model/device. Try q8 or WASM CPU.");
    }
  } finally {
    setProgress(0);
  }
}

async function getTranscriber() {
  const model = elements.model.value.trim() || DEFAULT_MODEL;
  const requestedDevice = elements.device.value;
  const device = requestedDevice === "auto" ? await chooseDevice() : requestedDevice;
  const dtype = elements.dtype.value || "q4";
  const key = `${model}|${device}|${dtype}`;

  if (state.transcriber && state.transcriberKey === key) return state.transcriber;

  setStatus(`Loading ${model} (${device}, ${dtype})...`);
  setProgress(1);
  let loadedDevice = device;

  try {
    state.transcriber = await pipeline("automatic-speech-recognition", model, {
      device,
      dtype,
      progress_callback: (progress) => {
        if (typeof progress?.progress === "number") setProgress(progress.progress);
        if (progress?.status) setStatus(`${progress.status}: ${progress.file || model}`);
      }
    });
  } catch (error) {
    if (device === "webnn-npu") {
      setStatus(`NPU load failed, falling back to WebGPU/WASM: ${formatError(error)}`);
      const fallbackDevice = "gpu" in navigator ? "webgpu" : "wasm";
      loadedDevice = fallbackDevice;
      state.transcriber = await pipeline("automatic-speech-recognition", model, {
        device: fallbackDevice,
        dtype,
        progress_callback: (progress) => {
          if (typeof progress?.progress === "number") setProgress(progress.progress);
          if (progress?.status) setStatus(`${progress.status}: ${progress.file || model}`);
        }
      });
    } else {
      throw error;
    }
  }
  state.transcriberKey = key;
  setStatus(`Model ready (${loadedDevice}, ${dtype}).`);
  setProgress(100);
  return state.transcriber;
}

async function sendCommand(command) {
  if (!command) return;
  const wakeResult = extractWakeCommand(command);
  const commandText = wakeResult.command;
  if (!commandText) {
    setStatus('Wake phrase heard. Now say a command like "scroll down".');
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "VOICE_COPILOT_RUN_COMMAND_IN_TAB",
    tabId: targetTabId,
    command: commandText,
    fromVoice: true,
    wakeVerified: true
  });

  if (!response?.ok) {
    setStatus(`Could not send command: ${response?.error || "unknown error"}`);
    return;
  }
  const commandResult = response.result?.response?.result;
  if (commandResult?.reason === "wake-word-missing") {
    setStatus('Wake phrase missing. Click record again and say a command.');
    return;
  }
  if (commandResult?.reason === "not-understood") {
    setStatus(`Command not understood: ${commandText}`);
    return;
  }
  if (commandResult?.reason === "confirmation-required") {
    setStatus(`Confirmation required. Record again and say "confirm".`);
    return;
  }
  if (commandResult?.executed === false) {
    setStatus(`Command not executed: ${commandResult.reason || "unknown reason"}`);
    return;
  }
  setStatus(`Sent command: ${commandText}`);
}

function extractWakeCommand(rawCommand) {
  const normalized = normalizeSpeechText(rawCommand);
  const wakePhrases = [
    "hey browser",
    "hay browser",
    "hey browzer",
    "hey browse her",
    "ok browser",
    "okay browser"
  ];

  for (const wakePhrase of wakePhrases) {
    if (normalized === wakePhrase) return { wakeDetected: true, command: "" };
    if (normalized.startsWith(`${wakePhrase} `)) {
      return {
        wakeDetected: true,
        command: normalized.slice(wakePhrase.length).trim()
      };
    }
  }

  return { wakeDetected: false, command: normalized };
}

function normalizeSpeechText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function decodeTo16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  const decoded = await audioContext.decodeAudioData(arrayBuffer);
  const source = decoded.getChannelData(0);
  const resampled = resampleLinear(source, decoded.sampleRate, TARGET_SAMPLE_RATE);
  await audioContext.close();
  return resampled;
}

function resampleLinear(input, inputRate, outputRate) {
  if (inputRate === outputRate) return new Float32Array(input);

  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const index = i * ratio;
    const before = Math.floor(index);
    const after = Math.min(before + 1, input.length - 1);
    const weight = index - before;
    output[i] = input[before] * (1 - weight) + input[after] * weight;
  }

  return output;
}

async function chooseDevice() {
  if ("ml" in navigator) return "webnn-npu";
  if ("gpu" in navigator) return "webgpu";
  return "wasm";
}

function configureTransformers() {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("node_modules/onnxruntime-web/dist/");
  env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
}

async function detectHardware() {
  const hasWebGPU = "gpu" in navigator;
  const hasWebNN = "ml" in navigator;
  const pieces = [
    hasWebNN ? "WebNN detected: NPU option enabled" : "WebNN/NPU not exposed",
    hasWebGPU ? "WebGPU available" : "WebGPU unavailable"
  ];
  elements.hardware.textContent = pieces.join(" | ");
}

function chooseMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function setStatus(message) {
  elements.status.textContent = message;
}

function setProgress(value) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  elements.progressBar.style.width = `${normalized}%`;
}

function formatError(error) {
  return error?.message || error?.name || String(error);
}
