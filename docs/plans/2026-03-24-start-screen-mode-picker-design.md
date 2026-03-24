# Start Screen: Inference Mode Selection

## Problem

The current start screen immediately shows a ~1.8 GB WASM model download. Users with access to a GPU server have no way to skip this and go straight to GPU inference.

## Design

Replace the current start screen model download UI with a mode picker: two side-by-side cards letting the user choose GPU server or local WASM before anything downloads.

### Layout

The start screen keeps its current branding (video background, title, description). Below the description, two cards:

**Card 1: GPU Server**
- Text field pre-filled with last-used URL from localStorage (if any)
- "Connect" button that runs a health check
- Inline status: connecting spinner, success (GPU name/memory), or error message
- On success: redirect to `/viewer`

**Card 2: Local (WASM)**
- Brief note: "Download ~1.8 GB of models to run entirely in your browser"
- "Download Models" button -> existing ModelManager progress UI
- On complete: redirect to `/viewer`

### Behavior

- **First visit**: Both cards shown, no pre-fill, user picks
- **Return visit with saved GPU URL**: URL pre-filled, user still sees choice screen, must click Connect
- **Return visit with cached WASM models**: WASM card shows "Models cached" with a "Continue" button
- **GPU health check fails**: Error shown inline on GPU card, user can fix URL or switch to WASM
- **GPU mode selected**: Skip WASM model download entirely, set `gpuServerUrl` in localStorage, workers not initialized until needed

### What stays the same

- Header GPU settings panel for changing/disconnecting mid-session
- Worker architecture unchanged -- just controlled by which path the user picked

### What changes

- Auto-detect GPU logic removed from startup (user explicitly chooses now)
- ModelManager no longer shown by default on start screen -- only after user picks WASM
