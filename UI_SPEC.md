# TinyVoice — UI/UX Specification

> Handout for designers. Describes every screen, element, state, and interaction. Layout and visual design decisions are yours — this document tells you *what* exists, not *how* it should look.

## What This App Does

Browser-based voice chat with two modes:

1. **Push-to-Talk (PTT)** — join a room, hold a button to record, release to send voice to everyone in the room. Incoming voice auto-plays. Think walkie-talkie.
2. **QR Voice Messages** — record a short voice clip, encode it into a tiny data payload, generate a QR code. Anyone who scans it hears the message — no server, no account, decoded entirely in their browser.

Both modes use the same neural speech codec (FocalCodec). Models are large (~800 MB total) and must be downloaded once, then cached in the browser. This download/initialization flow is a key UX moment.

---

## Navigation

Two top-level pages: **PTT** and **QR**, switchable via nav tabs in the header. Both pages share a **Settings** panel (slides in from the right).

The header contains:
- App name "TinyVoice"
- Two nav pills: PTT | QR (active one is highlighted)
- Settings gear icon (opens settings sheet)

On the PTT page specifically, the header also shows live stats: bytes sent, bytes received, user count.

---

## Theme System

Multiple color themes, user-selectable, persisted in localStorage. Currently 6 (5 dark, 1 light) but the number and palette choices are up to you. The theme switcher lives in the Settings panel.

The current implementation uses a layered surface system and semantic color tokens. You're free to redesign the color architecture — just ensure the system supports:
- Multiple surface/elevation levels for visual depth
- A text hierarchy (primary, secondary, disabled)
- Semantic states that are distinguishable: success/ready, recording/danger, loading/warning, received data
- At least one light and one dark variant
- Switchable at runtime via a data attribute or class

The existing 6 themes (for reference, not prescription):
1. **Mocha** (default dark) — blue-lavender accent
2. **Nord** — cool gray-blue accent
3. **Rose Pine** — mauve-purple accent
4. **Solarized Dark** — warm blue accent
5. **Midnight** — near-black, muted blue accent
6. **Latte** (light mode) — cream background, vivid blue accent

---

## PTT Page

### Layout
Two-pane layout: fixed-width sidebar (left) + main content area (right), inside a bordered container centered on screen.

### Sidebar

#### You (Username)
- Text input, placeholder "your name"
- Persisted across sessions
- Monospace font

#### Room
**Disconnected state:**
- Text input for room name + join button (arrow icon) + random name button (shuffle icon)
- List of rooms below: either active rooms (fetched from server, showing active indicator, user count, and the room's locked quality) or suggested fallback rooms (static list, inactive indicators)
- Clicking any room joins it

**Connected state:**
- Beacon animation (pulsing dot with expanding ring, conveying "connected") + room name + the room's locked quality as an accent chip + online count
- User tags: small pills showing each connected username
- Leave button

**Room quality lock:** a room's codec quality is set by its first participant (announced at join, or locked by the first packet's magic byte) and cleared when the room empties. The relay rejects packets that don't match; joiners adopt the room's quality automatically, downloading models with visible progress if needed. While in a locked room, other qualities are disabled in the codec section with a "Quality locked by room" note.

#### Codec
- Quality selector: three chips (12.5hz | 25hz | 50hz). The active quality is highlighted; unloaded qualities show a download marker and clicking one downloads then activates it. Disabled (except the room's own) while a room lock applies.
- Status indicator (visually distinct ready vs not-loaded states) + status text
- Progress bar (visible only during download/initialization)
- Main action button with 4 label states:
  - "Download Models" — nothing cached
  - "Initialize Models" — all cached, needs WASM init
  - "Initializing..." — in progress
  - "Ready" — done, disabled
- Clear Cache button with confirmation flow:
  - First click: shows "Yes, delete all" + "Cancel"
  - Cancel or timeout: reverts to "Clear Cache"

#### Bottom
- Settings button (gear icon + "Settings" text) → opens settings sheet

### Main Area

#### PTT Button (center)
Large circular button (130px), the primary interaction element.

**4 states:**
1. **Disabled** — very dim, cursor blocked. Shown when models aren't loaded or no room joined.
2. **Idle** — neutral styling, mic icon, "HOLD" label. Hover should indicate interactivity.
3. **Recording** — visually urgent/active, square (stop) icon, "RELEASE" label. Should feel alive (animation, glow, pulse — your call).
4. **Encoding** — visually distinct "processing" state, spinning loader icon, "ENCODING" label.

**Interaction:** hold to record, release to stop. Leaving the button area also stops (for mobile touch safety).

#### Waveform
Appears below the PTT button only during recording. Real-time audio visualization — a flowing line updated every animation frame. Color should match the recording state.

#### Hint Text
"hold to talk · release to send" — shown when idle, hidden during recording.

#### Incoming Voice Hex Stream
While received audio is playing, show the packet as dense wrapped rows of two-character hexadecimal bytes, matching the Hex Sheet. Keep the codec header inline and highlighted with the accent color. The approximately current payload byte is bold green with a soft glow and drags a short comet tail: the last few played bytes fade from green back to the resting text color. Unplayed bytes render dimmed; played bytes settle at the resting color. The dump may auto-follow internally, but must not scroll the surrounding page.

#### Stats Strip
4 equal-width stat cards in a row: Bytes Sent, Encode Time, Bytes Recv, Decode Time.

Values show formatted sizes ("256 B", "1.2 KB") or times ("0.42s"). Placeholder "—" should be visually dimmed vs active values. Sent and received stats should be visually distinguishable from each other.

#### Voice Message List
The main conversation surface below the stats: a chat-style list of this session's voice messages, newest at the bottom with auto-scroll. Sent messages align right, received left. Each bubble shows sender (You / their name — relayed packets carry the sender's name), time, duration, byte size, quality label, a play/stop button, and a "hex" toggle that expands the raw dump inline. Any message can be replayed, including your own; the playing bubble is visually distinct and drives the shared hex stream. Received messages still auto-play on arrival. Session-scoped only: the relay keeps no history, the list caps at 100 messages and clears when leaving or switching rooms.

**Empty state:** centered mic icon (dimmed) + "Voice messages appear here".

#### Diagnostics (demoted activity log)
A collapsed strip below the message list: "▸ Diagnostics · N". Expanding reveals the scrollable monospace activity log.

**Entry types** (each needs a visually distinct treatment):
- **ok** — successful operations
- **info** — informational
- **warn** — warnings
- **dim** — low priority / background noise
- **recv** — received data (should be distinguishable from sent)
- **name** — identity events (should stand out)

Some entries include expandable hex dumps (click to toggle). Hex bytes should be color-coded by direction (sent vs received).

Max 200 entries retained, auto-scrolls to bottom on new entries.

#### Share Modal
Appears automatically after encoding a voice message. Dialog with:
- QR code image (generated from playback URL)
- Metadata: bytes, tokens, duration
- Read-only URL input + Copy button (shows "Copied!" for 1.5s)
- Instruction text: "Scan QR or share the link"

---

## Layout Ethoses (Shared)

The app has two design ethoses, chosen in the Settings panel and persisted:

- **Stage Swap** (default) — one stage at a time. Producing a result swaps the whole canvas to it; a "← back" affordance returns to the controls. Nothing stacks, nothing scrolls.
- **Split Deck** — controls dock into a compact left rail and the result owns a wide right pane, both always visible. The page widens to fit; on narrow screens it falls back to a stacked column.

Both ethoses apply to the QR page's Record and Decode tabs. The PTT page is a split deck by construction (sidebar + main).

## QR Page

### Layout
Single centered card, max-width ~520px in Stage Swap and ~840px in Split Deck. Tabbed interface: **Record** | **Decode**. The card is fixed to the viewport; no inner scroll within a scroll.

Default tab is Decode if the URL contains voice data (`?v=`), otherwise Record.

### Record Tab

Stage Swap: the record stage shows quality, codec, and the HOLD button; encoding swaps the canvas to the result stage, headed by "← New recording" plus a quality/duration/bytes summary chip. Split Deck: quality, codec, and a smaller HOLD button stack in the rail; the result pane shows the QR card, or a dashed placeholder before the first take.

A visible **"Trim lead-in silence"** toggle sits by the record button (persisted, default on). When on, dead silence before speech is cut ahead of encoding. The gate is noise-floor adaptive — the threshold scales off the recording's own quietest windows, so "silentish" room tone counts as silence — and keeps a ~100ms pre-roll. Encode success must not leave a status line behind in the codec card — the result view itself is the feedback.

#### Quality Picker
3 radio options in a segmented control:
| Option | Label | Description |
|--------|-------|-------------|
| 12.5hz | "12.5hz" | "tiny QR · 25 B/s + header" |
| 25hz | "25hz" | "balanced · 50 B/s + header" |
| 50hz | "50hz" | "best quality · 100 B/s + header" |

Each option shows a cache indicator:
- ✓ if that quality's compressor model is cached (should feel "ready")
- ↓ (gray) if not cached
- Empty while checking

Indicators refresh after models are downloaded.

#### Codec Status
Same pattern as PTT sidebar codec section: status dot, progress bar, action button. Button label reflects what will actually happen:
- "Download Models" — nothing cached
- "Download & Initialize" — encoder cached but compressor for selected quality needs download
- "Initialize Models" — everything cached
- "Initializing..." — in progress

Status text below the button (hidden when empty) shows contextual messages.

#### Record Button
100px circular button, similar to PTT but smaller.

**States:** disabled (dimmed), idle, recording (visually urgent, no pulse unlike PTT), encoding (processing feel, pulsing).

**Icon:** mic (idle) or spinning indicator (encoding). Label: "HOLD" or "ENCODING".

**Interaction:** hold to record, release to encode. Same pointer events as PTT.

#### Waveform + Timer (during recording)
Side by side: waveform canvas + elapsed time counter in monospace ("2.3s"), updated every 100ms. Color should match recording state.

#### Encode Progress
Small progress bar, only visible during encoding.

#### QR Result (after successful encode)
Appears as a card below the record button:

**QR Code Image:** 180x180px, white background, rounded corners.

**Metadata row:** bytes | tokens | duration (monospace, small).

**Action buttons** (row, wrapping):
1. **Preview** — play/stop toggle. Shows ▶ "Preview" or ■ "Playing..." (playing state needs distinct visual). Decodes and plays the audio. Caches decoded audio for instant replay.
2. **Copy URL** — copies shareable URL. Shows "Copied!" for 1.5s.
3. **Copy hex** — copies the complete packet as lowercase, space-separated hexadecimal bytes.
4. **Save hex** — downloads the same hex bytes as a text file (round-trips through the Decode tab's hex input).
5. **Download** — downloads QR as PNG file.
6. **Hex** — opens hex sheet sidebar showing raw bytes.

While Preview is playing, show the shared approximate hex stream for the full packet.

**Decoder override** (row below actions):
Label "Decoder:" + 4 small buttons: Auto | 12.5hz | 25hz | 50hz. Active button is highlighted. Switching decoder clears cached audio, forcing re-decode on next Preview. This lets users intentionally decode with a mismatched model to hear the artifacts.

**Preview status:** small text showing decode progress or errors.

### Decode Tab

The page itself is fixed to the viewport and must not scroll. A compact source switcher shows exactly one input method at a time: **Hex**, **Upload**, or **Camera**. The selected method may manage its own bounded overflow when necessary.

Stage Swap: loading a packet swaps the canvas to the player, headed by "← New source" plus a bytes/quality summary chip. Split Deck: the source switcher lives in the left rail and the player owns the right pane (dashed placeholder until a packet loads).

#### Hexadecimal Input
A fixed-height multiline text input accepts a complete voice packet as hexadecimal bytes. It supports compact hex, whitespace/comma-separated bytes, and optional `0x` prefixes. Invalid characters, incomplete bytes, and data that is not a valid TinyVoice packet are reported beside the field. Cmd/Ctrl+Enter submits the input. After a valid submission, collapse the editor to a one-line byte summary with an Edit action.

#### Dropzone
Dashed-border rectangular area. Accepts:
- QR code images (PNG, JPG) — detected and decoded via jsQR
- Binary files (.bin or raw) — read as voice packet data

**States:**
- Default: dashed border, folder icon, "Drop QR image, .bin, or raw bytes", "click to browse files"
- Drag over: highlighted border, slight tint background

**Interaction:** click opens file picker, drag-and-drop also works.

#### Camera Scanner
Toggle button: "Start Camera" / "Stop Camera" (with camera icon).

**When active:**
- Live video feed with a semi-transparent scan frame overlay (square centered in the video, should feel like a viewfinder)
- Scans for QR codes every 250ms
- Auto-stops camera when QR is detected

#### Error Message
Error text, centered, shown when file/QR processing fails. Should be visually distinct as an error.

#### Player (when voice data is loaded)
Appears after successful hex entry, file drop, camera scan, or URL parameter decode — placed per the active layout ethos (Stage Swap: replaces the source switcher; Split Deck: fills the right pane). Keep it visible in the fixed decode layout so users never have to search below input cards.

**Play button:** large circle. Three visual states: idle, playing, loading. Each must be distinguishable. Icons: play triangle, stop square, or spinning indicator.

**Hex button:** beside play button, opens hex sheet.

**Quality override buttons:** same as QR Result — Auto | 12.5hz | 25hz | 50hz. Switching clears cached audio.

**Progress bar:** visible during decode.

**Status text:** shows packet info (size, token count, estimated duration, detected quality). If a legacy packet has no magic byte, shows the explicit 50 Hz legacy fallback. Updates during decode with progress messages.

While audio is playing, show the shared approximate hex stream using the original full packet, including its codec header when present.

---

## Settings Panel (Shared)

Slides in from the right edge. Used on both PTT and QR pages — the same panel everywhere.

Sections are organized into three tabs so the panel never becomes a long scroll: **General** (Username, Layout, Theme), **Audio** (Microphone), **Models** (Codec Status, Model Management).

### Sections

#### Username
Text input, monospace, persisted in localStorage.

#### Layout
Two-option picker for the layout ethos: **Stage Swap** | **Split Deck**, each with a one-line description. Persisted in localStorage; applies immediately.

#### Microphone
- **Input device** select (system default + enumerated inputs; device names appear once mic permission is granted).
- **Gain** slider, 50%–300%, applied to the recording chain (and to the live test) — persisted.
- **Test mic** button with a live level meter showing the post-gain peak level; the bar turns red and reads "clipping" above 95%. Testing stops on panel close.

#### Codec Status
Same dot + text + progress + button pattern. Shows current codec state.

#### Model Management
Organized in 4 groups:

| Group | Models | Total Size |
|-------|--------|-----------|
| Shared encoder | encoder.onnx | ~595 MB |
| 50hz — best quality | compressor + decoder | ~205 MB |
| 25hz — balanced | compressor + decoder | ~213 MB |
| 12.5hz — smallest | compressor + decoder | ~217 MB |

Each group shows:
- Group label + "ready" badge if all models cached
- Brief explanation text
- Per-model rows: filename, size in MB, description, and status:
  - **Cached:** "cached" badge (success treatment) + trash (delete) icon
  - **Downloading:** progress bar + percentage
  - **Not cached:** "Download" button with download icon

Bottom: total cached size + "Clear All" button (with same confirmation flow as PTT sidebar).

#### Theme Picker
Grid of 6 theme options. Each shows:
- Color swatch (circle representing the theme)
- Theme name label
- Selected state has highlighted background/border

---

## Hex Sheet (Shared Component)

Side panel that slides in from the right. Shows raw byte data of voice packets.

- Title: "Token Data"
- Subtitle: "{N} bytes · raw hex dump"
- Content: monospace hex dump, each byte as 2-char hex. Highlight the first byte when a magic byte / codec identifier is present; legacy headerless packets have no highlighted header.

## Hex Stream (Shared Component)

Shows the loaded packet using the same dense one-byte raw dump as the Hex Sheet. The codec header remains inline and accented. During playback, the approximately current payload byte is bold green with a soft text glow and drags a comet tail — roughly the last seven bytes fade from green back to the resting text color, unplayed bytes are dimmed, and played bytes settle at the resting color. The bounded dump auto-follows internally; while idle, the rows remain visible with no green byte and no dimming. Do not add token pills, header badges, progress counters, or explanatory chrome.

---

## Global Interaction Patterns

**Tactile press feedback:** all buttons scale to 97% on active press.

**Smooth scrolling:** enabled globally.

**Noise texture:** subtle grain overlay on the full page background (fixed, pointer-events-none, very low opacity). Adds depth to flat surfaces.

**Glow effects:** subtle box-shadow halos for emphasizing active/important elements. Variants for different semantic states.

**Animated icons:** settings gear (rotates on hover), code brackets (spread on hover), copy (shifts on hover), download (bounces on hover), trash (shakes on hover), camera (flashes on hover). These are motion-based SVG components, not static icons.

---

## Key UX Moments

1. **First visit:** user has no models. Must download ~800 MB. Progress reporting is critical — show what's downloading, how fast, how much remains.

2. **Return visit:** models are cached in IndexedDB. Detection should be instant. Button should say "Initialize Models" (not "Download"). Initialization takes 2-3 seconds (WASM compilation).

3. **Recording:** the transition from idle → recording → encoding → result should feel immediate and responsive. The waveform provides visual confirmation the mic is working.

4. **QR sharing:** the generated QR encodes the entire voice message in the URL. No server needed. Scanning the QR on another device decodes and plays the message entirely client-side.

5. **Decoder override:** intentionally decoding with the wrong model produces garbled but interesting audio artifacts. This is a feature, not a bug — it's how users explore the codec's behavior.

---

## Technical Constraints for Designers

- All 6 themes must work. Design with CSS custom properties, not hardcoded colors.
- The app runs entirely in-browser. No server-side rendering, no SSR considerations.
- Large model downloads mean the "not yet loaded" state is the first thing most users see. It must be clear and not feel broken.
- Mobile: both pages must work on phones. PTT is hold-to-talk (touch), QR is used for scanning.
- The PTT page uses a two-pane layout on desktop but should adapt for narrow viewports.
- Font stack: Outfit (UI text) + JetBrains Mono (data, code, monospace elements).
