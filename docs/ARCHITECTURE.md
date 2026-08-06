# Browser Voice Copilot Architecture

## 1. Executive Summary

Browser Voice Copilot is a privacy-first Manifest V3 extension that lets users operate web pages by voice: scroll, click, type, navigate, refresh, undo, cancel, and resolve ambiguous page targets by number.

The shipped scaffold is an offline-first MVP:

| Area | MVP implementation | Production path |
| --- | --- | --- |
| Speech | Web Speech API from the page/content context | Optional local Whisper/WebNN/WebGPU recognizer |
| NLP | Local deterministic grammar and entity extraction | Hybrid grammar + local classifier + optional cloud reasoning |
| DOM automation | Visible interactive element ranking | Accessibility tree enrichment, iframe relay, semantic page model |
| UI | Shadow DOM floating overlay | Dockable overlay, side panel, voice history, onboarding |
| Privacy | No continuous background recording, no remote code, protected-field blocking | Encrypted profiles, local model packs, enterprise policy controls |

The design intentionally keeps AI optional. Core commands must work offline and under one second without sending page text, audio, or form data to a server.

## 2. System Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                          │
│                                                                 │
│  ┌──────────────┐        chrome.runtime        ┌──────────────┐ │
│  │ Popup/Options│ ───────────────────────────▶ │ MV3 Service  │ │
│  │ UI           │                              │ Worker       │ │
│  └──────────────┘ ◀─────────────────────────── │              │ │
│                                                └──────┬───────┘ │
│                                                       │         │
│                                                       │ messages│
│                                                       ▼         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Content Script, all frames                                │ │
│  │                                                            │ │
│  │  ┌────────────┐   ┌──────────────┐   ┌──────────────────┐ │ │
│  │  │ Voice      │ → │ Intent Parser│ → │ Command Executor │ │ │
│  │  │ Pipeline   │   └──────────────┘   └───────┬──────────┘ │ │
│  │  └────────────┘                              │            │ │
│  │        │                                     ▼            │ │
│  │        ▼                            ┌──────────────────┐ │ │
│  │  ┌────────────┐                     │ DOM Scanner +    │ │ │
│  │  │ Shadow DOM │ ◀────────────────── │ Element Ranker   │ │ │
│  │  │ Overlay    │                     └──────────────────┘ │ │
│  │  └────────────┘                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

Key principles:

| Principle | Decision |
| --- | --- |
| Least privilege | Use extension APIs only in the service worker; DOM work stays in content scripts. |
| Offline first | Basic commands use local grammar, not a network model. |
| User activation | Listening starts by shortcut or explicit mic tap; wake-word is parsed inside an active session. |
| Safe automation | Password, OTP, PIN, CVV, and credit-card fields are excluded. |
| Reviewability | MV3 extension code is packaged locally; no remotely hosted executable code. |

Official references used for volatile platform details:

- Chrome MV3 replaces persistent background pages with service workers and disallows remotely hosted extension code: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- Chrome manifest keys for service workers, commands, content scripts, CSP, host permissions, and options UI: https://developer.chrome.com/docs/extensions/reference/manifest
- MDN Web Speech API recognition/security overview: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- Microsoft Edge Add-ons packaging and privacy listing workflow: https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension

## 3. Component Breakdown

| Component | Runtime | Responsibility |
| --- | --- | --- |
| `manifest.json` | Browser | Declares MV3 extension surfaces, permissions, content scripts, options, and shortcut. |
| `src/background/service-worker.js` | Extension service worker | Settings, tab actions, URL normalization, active-tab command routing. |
| `src/content/content.js` | Web page frames | Speech recognition, local NLP, DOM scanning, overlay, command execution. |
| `src/popup/*` | Extension popup | Quick controls and sample command triggers. |
| `src/options/*` | Extension options page | Wake phrase, overlay, scroll speed, language, confirmation settings. |
| `docs/ARCHITECTURE.md` | Repository docs | Engineering guide and scale plan. |

Production split:

| Module | Future files |
| --- | --- |
| Voice | `src/voice/recognizer.ts`, `src/voice/wake-session.ts`, `src/voice/transcript-normalizer.ts` |
| NLP | `src/ai/grammar.ts`, `src/ai/intent-classifier.ts`, `src/ai/entities.ts`, `src/ai/context-memory.ts` |
| DOM | `src/dom/scanner.ts`, `src/dom/a11y-labels.ts`, `src/dom/iframe-relay.ts`, `src/dom/mutation-index.ts` |
| Execution | `src/commands/executor.ts`, `src/commands/safety.ts`, `src/commands/history.ts` |
| UI | `src/overlay/widget.ts`, `src/overlay/highlights.ts`, `src/overlay/theme.css` |

## 4. Folder Structure

Current scaffold:

```text
.
├── manifest.json
├── docs/
│   └── ARCHITECTURE.md
├── scripts/
│   └── validate-extension.ps1
└── src/
    ├── background/
    │   └── service-worker.js
    ├── content/
    │   └── content.js
    ├── options/
    │   ├── options.css
    │   ├── options.html
    │   └── options.js
    └── popup/
        ├── popup.css
        ├── popup.html
        └── popup.js
```

Scalable production structure:

```text
src/
├── ai/
├── background/
├── commands/
├── content/
├── dom/
├── overlay/
├── privacy/
├── shared/
├── storage/
├── voice/
└── browser/
```

## 5. Data Flow

Shortcut or widget activation:

```text
Keyboard shortcut / mic click
        │
        ▼
Content script starts SpeechRecognition
        │
        ▼
Final transcript
        │
        ▼
Normalize wake phrase + punctuation
        │
        ▼
Intent parser extracts action and entities
        │
        ├── Browser command ──▶ service worker ──▶ tabs API
        │
        └── Page command ─────▶ DOM scanner ─────▶ executor
                                      │
                                      ▼
                           highlight / ambiguity UI
```

Ambiguity flow:

```text
"click sign in"
     │
     ▼
Find 4 visible matching controls
     │
     ▼
Render numbered overlay and badges
     │
     ▼
"number 2"
     │
     ▼
Execute selected element
```

## 6. Feature-by-Feature Engineering

### Voice Recognition Pipeline

1. User presses `Ctrl+Shift+Y` or taps the mic.
2. Content script creates `SpeechRecognition`.
3. Interim transcripts update the overlay.
4. Final transcript is normalized.
5. Wake phrase is stripped if present.
6. Intent parser emits a command object.

Important production caveat: Web Speech API recognition support differs by browser and may use platform services. Firefox support is not equivalent to Chromium. For Firefox, ship a fallback text command palette or bundle a local recognizer.

### Intent Classification

MVP uses deterministic grammar because it is fast, auditable, private, and predictable.

| Spoken command | Intent |
| --- | --- |
| `scroll down` | `{ type: "scroll", direction: "down" }` |
| `click login` | `{ type: "click", target: "login" }` |
| `type wireless headphones in search` | `{ type: "type", text: "wireless headphones", target: "search" }` |
| `open youtube` | `{ type: "open", destination: "youtube" }` |
| `refresh page` | `{ type: "tab", action: "reload" }` |

Production adds a two-stage router:

1. Grammar handles high-confidence common commands.
2. Local classifier handles paraphrases and context.
3. Optional GPT-style planner handles complex page tasks after explicit user opt-in.

### DOM Element Detection

The scanner indexes visible controls:

- `button`
- `a[href]`
- editable `input`, `textarea`, `[contenteditable]`
- ARIA controls such as `[role=button]`, `[role=link]`, `[role=tab]`, `[role=textbox]`
- labels, `aria-label`, `placeholder`, `title`, `alt`, text content, `id`, and `name`

Protected fields are excluded:

- password
- OTP/PIN/passcode
- CVV/CVC
- credit-card autocomplete fields

### Dynamic Website Handling

MVP queries the live DOM at execution time, which works well for React/Vue because it sees rendered DOM, not framework internals.

Production should add:

- `MutationObserver` with a throttled element index.
- SPA route-change detection through history event patching.
- iframe frame IDs and relay commands through the service worker.
- stale element recovery by re-querying before click/type execution.

### Accessibility Support

Accessibility is a product feature, not a bonus:

- Prefer accessible names before visual text.
- Use role-aware control detection.
- Keep overlay keyboard reachable.
- Provide visual state and text state.
- Respect reduced motion.
- Add a command palette fallback for users who cannot use speech recognition.

### Overlay Rendering

The overlay uses Shadow DOM so site CSS cannot accidentally break it. It includes:

- Floating mic widget.
- Listening indicator.
- Waveform animation.
- Transcript/status text.
- Numbered ambiguity list.
- Page element badges and highlight rings.

### Command Execution Engine

Execution rules:

| Command | Execution |
| --- | --- |
| Scroll | `window.scrollBy` with configured speed |
| Click | focus, pointer/mouse events, native click event |
| Type | native value setter + `input` and `change` events for React/Vue compatibility |
| Open site | service worker normalizes destination and updates tab |
| Back/forward/reload | service worker uses tabs API |
| Undo | revert scroll or typed value when safe |
| Cancel | clear pending command and highlights |

## 7. Code Examples

Starter code is implemented in this repository. The most important entry points:

- `manifest.json`
- `src/background/service-worker.js`
- `src/content/content.js`
- `src/options/options.html`
- `src/popup/popup.html`

Minimal manifest pattern:

```json
{
  "manifest_version": 3,
  "background": { "service_worker": "src/background/service-worker.js" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/content.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "permissions": ["activeTab", "scripting", "storage", "tabs"]
}
```

Minimal command object:

```js
{
  type: "click",
  target: "login",
  confidence: 0.94,
  safety: "normal"
}
```

## 8. AI/NLP Design

### Command Grammar

```text
SCROLL        := "scroll" ("up" | "down" | "left" | "right") | "page up" | "page down"
CLICK         := ("click" | "press" | "tap") TARGET
TYPE          := ("type" | "enter" | "write") TEXT ("in" | "into" | "on") TARGET
OPEN          := ("open" | "go to" | "navigate to") DESTINATION
TAB_ACTION    := "go back" | "go forward" | "refresh page" | "reload page"
CONFIRMATION  := "confirm" | "cancel" | "undo" | "try again"
SELECTION     := ("number" | "option" | "choose" | "select") INTEGER
```

### Intent Mapping

| Intent | Required entities | Optional entities |
| --- | --- | --- |
| `scroll` | `direction` | `amount`, `speed` |
| `click` | `target` | `ordinal`, `container` |
| `type` | `text`, `target` | `submitAfterTyping` |
| `open` | `destination` | `disposition` |
| `tab` | `action` | none |

### Context Memory

Keep short-lived context only:

| Memory | TTL | Purpose |
| --- | --- | --- |
| `pendingCommand` | Current interaction | Confirmation and retry |
| `candidates` | Current ambiguity session | Number selection |
| `lastAction` | Last reversible action | Undo |
| `lastTargetText` | Current page session | Follow-up commands |

### Ambiguity Resolution

If top two elements score close together, do not guess. Highlight options and ask the user to choose by number.

## 9. UI/UX System

Design direction: quiet futuristic utility, not a loud assistant avatar.

| Token | Value |
| --- | --- |
| Radius | 8px |
| Primary | `#1769e0` |
| Danger/listening | `#d12c4a` |
| Elevation | soft shadow with backdrop blur |
| Typography | system UI stack |
| Motion | short waveform, no layout shift |

States:

- Idle: mic button, shortcut hint.
- Listening: red mic, waveform, live transcript.
- Thinking: status text.
- Ambiguous: numbered list and page badges.
- Error: concise recovery text.

Accessibility:

- Visible status text mirrors voice state.
- Overlay does not trap focus.
- Buttons use `aria-label`.
- Dark mode follows system color scheme.

## 10. Security Model

| Risk | Mitigation |
| --- | --- |
| Continuous recording | No background recording; recognition starts only by shortcut/widget. |
| Sensitive form capture | Password, card, OTP, PIN, and CVV fields are blocked. |
| Dangerous clicks | Delete/pay/submit/send/logout require confirmation by default. |
| Remote-code injection | No remotely hosted executable code; packaged JS only. |
| Overbroad host access | MVP uses `<all_urls>` for universal control; production should offer optional host permissions by domain. |
| Page CSS interference | Overlay uses Shadow DOM. |
| Service worker state loss | Persist settings in `chrome.storage`; keep runtime context in content scripts. |
| Prompt injection from web pages | Never let page text directly become privileged browser actions without policy checks. |

Privacy defaults:

- Do not store transcripts unless the user opts in.
- Do not send audio to the network for basic commands.
- Do not store page text by default.
- Encrypt any learned personalization profile with WebCrypto.
- Provide a one-click local data reset.

## 11. Performance Optimization

Targets:

| Metric | Target |
| --- | --- |
| Common command latency | Under 1 second |
| Idle CPU | Near zero |
| Active listening CPU | Below 5% on modern laptops |
| DOM scan | Under 50 ms for common pages |

Strategies:

- Query DOM only after final transcript, not continuously.
- Limit ranking to visible interactive elements.
- Use throttled `MutationObserver` only in beta/production.
- Lazy-load ML models after user enables advanced AI.
- Cache labels and invalidate on mutation.
- Keep service worker stateless and short-lived.
- Avoid React in the content overlay unless bundling is already needed.

## 12. Testing Strategy

| Layer | Tools | What to test |
| --- | --- | --- |
| Unit | Vitest/Jest | parser, entity extraction, safety checks, URL normalization |
| DOM | Playwright | click/type/scroll on static pages and SPA fixtures |
| Extension | Playwright Chromium extension mode | manifest load, popup, options, shortcut routing |
| Voice | Mock `SpeechRecognition` | interim/final transcript flows and errors |
| Accessibility | axe-core, manual keyboard testing | overlay labels, contrast, focus behavior |
| Performance | Chrome DevTools Protocol | latency, CPU, memory, DOM scan time |
| Cross-browser | Chrome, Edge, Firefox | API availability and fallback behavior |

Required fixtures:

- Standard HTML form.
- Search page.
- React controlled input.
- Vue controlled input.
- Shadow DOM page.
- Cross-origin iframe page.
- Long infinite-scroll page.
- Checkout-like page with protected fields.

## 13. Deployment Pipeline

```text
main branch
   │
   ▼
lint + unit tests + extension validation
   │
   ▼
Playwright extension smoke tests
   │
   ▼
build ZIP artifacts
   │
   ├── Chrome Web Store package
   ├── Microsoft Edge Add-ons package
   └── Firefox package or alternate manifest package
```

Chrome Web Store:

1. Build a ZIP containing `manifest.json`, `src`, docs/assets needed by the extension, and icons.
2. Upload in the Chrome Web Store Developer Dashboard.
3. Complete privacy practices accurately.
4. Justify `<all_urls>` and sensitive permissions.
5. Ship staged rollout and monitor review feedback.

Microsoft Edge Add-ons:

1. Prepare a ZIP package.
2. Submit through Microsoft Partner Center.
3. Fill privacy declarations and listing metadata.
4. Validate package errors before review.

Firefox Add-ons:

1. Maintain a Firefox-specific manifest if SpeechRecognition/Chrome APIs differ.
2. Use `browser.*` compatibility wrappers or a build-time adapter.
3. Provide a non-speech command palette fallback if speech recognition is unavailable.

Versioning:

- SemVer for source.
- Store version increments for every upload.
- Release channels: `dev`, `beta`, `stable`, `enterprise`.

## 14. Scaling Recommendations

For millions of users:

- Keep the default mode fully local to reduce infra cost and privacy risk.
- Add optional cloud AI only after explicit consent and clear data boundaries.
- Use feature flags delivered as signed static config, not executable code.
- Separate model downloads from extension updates.
- Build telemetry around counts and timings, not transcript content.
- Create enterprise policies for disabled domains, data retention, and model mode.
- Move extension API abstraction into `src/browser` for Chrome/Edge/Firefox variance.

## 15. Future Roadmap

### MVP

- Local grammar parser.
- Scroll/click/type/open/back/refresh.
- Shadow DOM overlay.
- Settings page.
- Protected field checks.

### Beta

- Mutation-based element index.
- iframe relay.
- Command palette fallback.
- React/Vue test fixtures.
- Optional host permissions.
- Voice history stored locally.

### Production

- Local intent classifier.
- WebGPU/WebNN model acceleration where available.
- Local Whisper option.
- Enterprise policies.
- Encrypted personalization.
- Full browser-store packaging automation.

### Scaling

- GPT-powered contextual browsing with explicit opt-in.
- AI element understanding using page semantics and screenshot embeddings.
- Multimodal pointing: voice + cursor + highlighted regions.
- Smart autofill for user-approved profiles.
- Personalized command learning with local-only training data.

## Best Open-Source Tools

| Need | Recommendation |
| --- | --- |
| Extension build | Vite, Extension.js, webextension-polyfill |
| Testing | Playwright, Vitest, axe-core |
| Local NLP | compromise, wink-nlp, chrono-node |
| Local ML runtime | ONNX Runtime Web, Transformers.js, TensorFlow.js |
| Speech fallback | whisper.cpp, Transformers.js Whisper models |
| Storage | idb, Dexie |
| Security | DOMPurify for any HTML rendering, WebCrypto |

## Best AI Models

| Use case | Model |
| --- | --- |
| Local command classification | MiniLM, DistilBERT, ModernBERT-small ONNX |
| Local speech recognition | Whisper tiny/base quantized |
| Cloud contextual planning | GPT-4.1/4o-class or newer tool-use model with strict action schema |
| Element understanding | Small vision-language model for screenshot + DOM labels |

## Monetization Strategies

| Tier | Features |
| --- | --- |
| Free | Basic local commands, overlay, settings |
| Pro | Advanced local models, command history, custom macros |
| Team | Shared command packs, admin policies, private deployment |
| Enterprise | Compliance controls, audit logs, managed storage, support SLA |

Privacy should be the brand moat. Do not monetize by selling browsing data.

## Startup Product Path

1. Start with accessibility and productivity users who already feel the pain.
2. Build trust through local-first design and clear privacy guarantees.
3. Offer workflows for sales, support, research, and QA teams.
4. Add enterprise domain allowlists and admin policy support.
5. Expand from browser control into browser task automation with user-confirmed plans.

## Clarifying Questions Before Final Architecture Freeze

1. Is the first target browser Chrome only, or must Firefox support ship in v1?
2. Should advanced AI be fully local, cloud opt-in, or hybrid?
3. Are you building this for accessibility users, power users, enterprise teams, or all three?
4. Should commands execute immediately, or should every click/type command preview first?
5. Do you want typed dictation to submit forms automatically when the command implies search?
6. Which languages should v1 support beyond English?
7. Are there regulated-data requirements such as HIPAA, SOC 2, GDPR, or enterprise audit logs?
