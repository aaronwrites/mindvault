---
name: MindVault
description: A warm editorial collection for personal knowledge and evidence-grounded recall.
colors:
  primary: "#60435f"
  primary-foreground: "#ffffff"
  background: "#f7f5f0"
  foreground: "#292623"
  card: "#ffffff"
  secondary: "#ede9e2"
  secondary-foreground: "#49433d"
  muted: "#efebe5"
  muted-foreground: "#70675e"
  accent: "#eee7ee"
  accent-foreground: "#60435f"
  destructive: "#a13238"
  border: "#ded8cf"
  input: "#a59a8f"
  dark-background: "#211e1c"
  dark-foreground: "#f4f0e8"
  dark-card: "#2c2825"
  dark-primary: "#d3b4d1"
  dark-primary-foreground: "#30212f"
  dark-muted-foreground: "#bbb0a4"
  dark-border: "#4c433c"
typography:
  headline:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "29px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-.025em"
  title:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "16px"
    lineHeight: 1.9
  label:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  card: "12px"
  control: "10px"
  overlay: "20px"
spacing:
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  7: "28px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    height: "44px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "44px"
  library-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: MindVault

## Direction

A personal visual collection with warm editorial typography, generous space, and quiet functional controls. This redesign supersedes the earlier red identity, outlined legend panels, animated status expansion, and rotating loading slogans. Content, provenance, and retrieval availability lead the experience.

Use an ivory canvas, white reading surfaces, charcoal text, muted stone metadata, and aubergine actions. Semantic green, blue, amber, and rose communicate availability and errors with visible text. Never use availability color as the only label.

## Typography and identity

Use the self-hosted Lora variable font for the typographic MindVault wordmark, collection headings, and item titles. Use self-hosted Manrope for controls, metadata, and reading. The original SIL Open Font License files ship in `client/public/fonts/`. Next's local font loader supplies preloading, swap, and serif/sans fallbacks without a runtime font service.

Prominent titles range from 21–34px. Body summaries use 16px with 1.9 line height; smaller card descriptions use 13px with 1.85 line height. Preserve complete, wrapping titles and a reading measure of at most 70–72ch. Long filenames and unbroken titles must wrap.

## Shell and collection

The compact header contains the wordmark, Ask, Add, and a collection menu containing Appearance and Trash. Search is the strongest control, with “What do you remember?”, an accessible Search label, Enter submission, and a clear button. All / Links / Files remain visible below it. No capture strip or introductory slogan appears above a populated collection. Paste/drop help remains beside Add and in the empty state.

The collection has one column below 640px, two from 640px, three from 1024px, and four from 1280px. CSS grid row spans follow measured card heights and use normal sparse placement, preserving DOM, visual reading, and keyboard sequence. Without ResizeObserver, use the ordinary responsive grid. Never reorder children into independent column arrays or use dense packing.

Image links use natural-ratio media. Text links use a typographic title and labeled description. Documents use actual format, title/filename, size, and available summary without invented cover art. Missing, icon-only, and broken link images use the text treatment. Availability text and organization exceptions remain visible. Every card has a visible actions menu; supplementary actions may appear on focus/hover.

Search uses a relevance-ordered list with thumbnails, visible matching excerpts, evidence provenance, and physical PDF page references. Clearing it restores the existing collection filter.

## Capture and lifecycle

Add opens a compact link-and-file dialog built with installed shadcn primitives. Preserve page paste, device-file drop, independent multi-file requests, duplicate recognition, and retry of only failed entries. Protect editable fields and open dialogs from capture shortcuts. Saving/uploading is separate from Processing: “Saved” appears only after durable API success. File understanding limitations are explained before selection. Batch feedback stays visible above the collection edge without removing successful items.

Trash uses a simple list. Keep restore, permanent-delete confirmation, pending deletion, cleanup failure, retry, and Undo states. Backend payloads and semantics stay unchanged.

## Details and Ask

Details use a centered overlay at up to 1120px with a dimmed collection backdrop. Below 768px, use the full viewport. The source/preview column sits beside the reading column and stacks on mobile; absent images leave no media placeholder. Title editing sits beside the title. Summary, personal notes, tags, and source details use plain section labels, whitespace, and subtle separators. Keep original-file open/download actions prominent.

Summary provenance and consequential coverage limitations sit beside summary text. Expandable Details carries extraction facts, recovery guidance, and refresh actions, and opens for limitations. Keep hash navigation, Back/Escape, collection position, focus restoration, draft recovery after failures, and background updates.

Ask uses a right companion panel on desktop and a full-screen mobile conversation. The collection stays behind it. The composer remains anchored below a scrolling conversation. Questions use a subtle plum surface; answers and supporting evidence use reading typography. Item details opened from citations layer above Ask and return to the same conversation and focus. Preserve local Ollama disclosure, session-only history, pending requests across close/reopen, failed follow-ups, and insufficient-evidence copy.

## Themes, shape, and motion

System is the default. Keep persisted Light/Dark/System preferences, pre-paint initialization, cross-tab synchronization, and immediate theme updates. Dark mode uses warm charcoal surfaces, ivory text, and a lighter plum action color.

Cards have 12px corners; controls 10px; desktop overlays 20px. Shared controls have visible focus, hover, disabled, and invalid states with mobile targets of at least 44px. Motion is limited to short fades, gentle image scaling, panel transitions, and truthful processing spinners. No gradients, bouncing status dots, decorative slogans, or rotating phrases. Reduced motion disables animations and transitions. Theme selection, caret, focus, and scrollbars from the active palette.
