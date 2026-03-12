# Riksarkivet Import — Design

## Summary

Add ability to load document pages directly from Riksarkivet by entering a reference code, instead of only uploading from disk.

## User Flow

1. User enters a reference code (e.g. `SE/RA/420177/02/A I a/3`) in a text input on the home page
2. Clicks "Load from Riksarkivet"
3. App resolves the reference code to a IIIF manifest, determines page count, and fetches all page images
4. Each page becomes an `ImageDocument` in the workspace — identical to local file upload
5. User proceeds to viewer as usual

## API Flow

```
Reference Code
  → OAI-PMH GetRecord (oai-pmh.riksarkivet.se/OAI)
  → Extract manifest ID from <dao> element
  → Fetch IIIF manifest (lbiiif.riksarkivet.se/arkis%21{id}/manifest)
  → Count items[] for total pages
  → Fetch each page image: lbiiif.riksarkivet.se/arkis%21{id}_{page}/full/max/0/default.jpg
  → Convert to ArrayBuffer → addDocument()
```

## Technical Details

- All Riksarkivet endpoints are CORS-enabled for browser fetch
- Must URL-encode `!` as `%21` in IIIF URLs (WAF blocks literal `!`)
- Page numbers are zero-padded to 5 digits (00001, 00042, etc.)
- IIIF manifest returns items[] array with exact page count
- Use limited concurrency (e.g. 3 parallel fetches) to avoid overwhelming the server
- Show progress as pages load (e.g. "Loading page 12/638...")

## UI

- New section on home page between model manager and file upload
- Text input + "Load" button
- Progress indicator while fetching
- Can coexist with file upload (user can do either or both)

## Components

- `RiksarkivetImport.svelte` — new component with input, button, progress
- `$lib/riksarkivet.ts` — API helper: resolveManifest(), fetchPages()
