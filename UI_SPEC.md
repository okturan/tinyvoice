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
- List of rooms below: either active rooms (fetched from server, showing active indicator + user count) or suggested fallback rooms (static list, inactive indicators)
- Clicking any room joins it

**Connected state:**
- Beacon animation (pulsing dot with expanding ring, conveying "connected") + room name + online count
- User tags: small pills showing each connected username
- Leave button

#### Codec
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

#### Stats Strip
4 equal-width stat cards in a row: Bytes Sent, Encode Time, Bytes Recv, Decode Time.

Values show formatted sizes ("256 B", "1.2 KB") or times ("0.42s"). Placeholder "—" should be visually dimmed vs active values. Sent and received stats should be visually distinguishable from each other.

#### Activity Log
Scrollable monospace log below the stats. Entries appear with a subtle slide-up animation.

**Entry types** (each needs a visually distinct treatment):
- **ok** — successful operations
- **info** — informational
- **warn** — warnings
- **dim** — low priority / background noise
- **recv** — received data (should be distinguishable from sent)
- **name** — identity events (should stand out)

Some entries include expandable hex dumps (click to toggle). Hex bytes should be color-coded by direction (sent vs received).

**Empty state:** centered mic icon (dimmed) + "Join a room & load models to start" + "Activity will appear here" subtitle.

Max 200 entries retained, auto-scrolls to bottom on new entries.

#### Share Modal
Appears automatically after encoding a voice message. Dialog with:
- QR code image (generated from playback URL)
- Metadata: bytes, tokens, duration
- Read-only URL input + Copy button (shows "Copied!" for 1.5s)
- Instruction text: "Scan QR or share the link"

---

## QR Page

### Layout
Single centered column, max-width ~520px. Tabbed interface: **Record** | **Decode**.

Default tab is Decode if the URL contains voice data (`?v=`), otherwise Record.

### Record Tab

#### Quality Picker
3 radio options in a segmented control:
| Option | Label | Description |
|--------|-------|-------------|
| 12.5hz | "12.5hz" | "tiny QR · ~144B" |
| 25hz | "25hz" | "balanced · ~288B" |
| 50hz | "50hz" | "best quality · ~576B" |

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
3. **Download** — downloads QR as PNG file.
4. **Hex** — opens hex sheet sidebar showing raw bytes.

**Decoder override** (row below actions):
Label "Decoder:" + 4 small buttons: Auto | 12.5hz | 25hz | 50hz. Active button is highlighted. Switching decoder clears cached audio, forcing re-decode on next Preview. This lets users intentionally decode with a mismatched model to hear the artifacts.

**Preview status:** small text showing decode progress or errors.

### Decode Tab

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
Appears after successful file drop, camera scan, or URL parameter decode.

**Play button:** large circle. Three visual states: idle, playing, loading. Each must be distinguishable. Icons: play triangle, stop square, or spinning indicator.

**Hex button:** beside play button, opens hex sheet.

**Quality override buttons:** same as QR Result — Auto | 12.5hz | 25hz | 50hz. Switching clears cached audio.

**Progress bar:** visible during decode.

**Status text:** shows packet info (size, token count, estimated duration, detected quality). If quality was guessed (no magic byte header), shows "(guessed)". Updates during decode with progress messages.

---

## Settings Panel (Shared)

Slides in from the right edge. Used on both PTT and QR pages.

### Sections

#### Username
Text input, monospace, persisted in localStorage.

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
- Content: monospace hex dump, each byte as 2-char hex. First byte (magic byte / codec identifier) should be visually highlighted vs the rest.

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
