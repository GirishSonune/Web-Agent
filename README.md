# Browser Voice Copilot

Privacy-first voice control browser extension built with Manifest V3.

## Run It Locally

1. Open Chrome or Microsoft Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder:

   ```text
   E:\Hight Level Projects\Web Interactivie Extension
   ```

6. Open a normal website such as `https://www.google.com`.
7. Click the extension icon.
8. Click **Open AI voice control**.
9. In the AI Voice Control tab, choose:
   - Device: `Auto` or `Intel NPU via WebNN`
   - Quantization: `4-bit q4`
10. Click **Hold to record**, speak a command, then click again to stop.
11. Allow microphone access if the browser asks.
12. Say a command directly after clicking record. The wake phrase `hey browser` is optional in this manual mode:

   ```text
   scroll down
   click search
   type wireless headphones in search
   press enter
   open youtube
   go back
   refresh page
   ```

   These also work:

   ```text
   hey browser scroll down
   hey browser press enter
   ```

## Local Validation

Run these from PowerShell inside the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\validate-extension.ps1
node --check src\background\service-worker.js
node --check src\content\content.js
node --check src\popup\popup.js
node --check src\options\options.js
node --check src\voice\voice.js
```

Expected result:

- `Extension structure looks valid.`
- No output from `node --check` commands.

## Important Browser Notes

- The extension does not run on browser-internal pages such as `chrome://extensions`.
- AI Voice Control uses local Transformers.js/Whisper ASR instead of the Web Speech API.
- AI Voice Control uses the record button as activation, so `scroll down` works after clicking record. If the transcript includes `hey browser`, it is stripped before command execution.
- The first AI transcription downloads model files from Hugging Face and may take a while.
- `Intel NPU via WebNN` works only when Chrome exposes WebNN/NPU through `navigator.ml`.
- Password, OTP, PIN, CVV, and credit-card fields are intentionally blocked.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Overlay does not appear | Reload the web page after loading the extension. |
| Shortcut does nothing | Go to `chrome://extensions/shortcuts` and confirm `Ctrl+Shift+Y` is assigned. |
| AI model download fails | Check internet access and the AI Voice Control status text. Model files are fetched from Hugging Face on first use. |
| q4 fails | Switch quantization from `4-bit q4` to `8-bit q8`, or switch device to `WASM CPU`. |
| NPU does not run | Use Chrome with WebNN/NPU enabled. If `WebNN/NPU not exposed` appears, the browser did not expose Intel AI Boost to web apps. |
| Mic does not start | Use the AI Voice Control tab and allow microphone access for the extension page. |
| Command cannot find an element | Try a visible label, for example `click login`, `click sign in`, or `number 1` after options appear. |
| Popup says reload page first | Reload the current tab so the content script is injected. |
