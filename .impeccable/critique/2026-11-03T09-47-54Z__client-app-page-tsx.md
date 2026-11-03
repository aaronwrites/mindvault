---
target: critique this interface and prioritize what to fix
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/aaron/Developer/mindvault/client/app/page.tsx"
target_fingerprint: "sha256:e09d3675124b4691c1538ce0d958f77822132e54b0eed409e91d786362531d9c"
target_path: /Users/aaron/Developer/mindvault/client/app/page.tsx
timestamp: 2026-11-03T09-47-54Z
slug: client-app-page-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/evidence_review)

Target: client/app/page.tsx and its capture, search, card, detail and Ask components. Operate surface. Live evidence: populated 11-save board at 1280×720 and 390×844; Add, Ask and item details. No user data changed.

MindVault has a usable foundation, but its hierarchy hides its strongest features. The first screen emphasizes a slogan and publisher logos; finding an idea, recognizing a save, and understanding its availability receive less attention. Keep default shadcn styling and fix task layout first.

## Design specificity

Purposeful language and evidence modeling sit inside a category-interchangeable bookmark-gallery composition. The opportunity is to make conceptual recall and trustworthy recognition visible. Decorative branding is lower priority than structure.

## Design health: 25/40 — Acceptable

| # | Heuristic | Score /4 | Key finding |
|---|---|---:|---|
| 1 | Visibility of system status | 2 | One amber dot represents several different conditions |
| 2 | Match with real world | 3 | Mostly clear; some infrastructure language leaks through |
| 3 | User control and freedom | 3 | Clear, close, Undo and restore exist; Ask lacks visible cancellation |
| 4 | Consistency and standards | 3 | Predictable components; board and detail prioritize different content |
| 5 | Error prevention | 3 | Good safeguards; file capability guidance arrives late |
| 6 | Recognition rather than recall | 2 | Generic descriptions and hidden status meanings hinder recognition |
| 7 | Flexibility and efficiency | 2 | Useful capture shortcuts are hard to discover |
| 8 | Aesthetic and minimalist design | 2 | Introductory content consumes working space |
| 9 | Error recovery | 3 | Useful retry paths in source; async outcomes untested |
| 10 | Help and documentation | 2 | Contextual explanations mainly inside dialogs |
| | Total | 25/40 | Functional foundation; hierarchy and disclosure need work |

Independent deterministic scan returned exit 0 and [] (zero findings). Browser/manual findings below do not overlap detector findings. No false positives to adjudicate. No user-visible overlay was injected.

## Strengths

- Capture feedback distinguishes safely saved information from ongoing processing.
- Item details provide useful evidence and coverage disclosures.
- The board avoids mandatory folders and tagging and uses predictable standard controls.

## Priorities

1. **[P1] Give mobile search enough room.** At 390px, the input is 119px wide and shrinks to 79px when Clear appears. Put search on a full-width row and move Filter/Ask beneath it. Enlarge measured 28–32px mobile controls toward 44px touch targets. This is a touch-usability recommendation, not a claimed WCAG violation. Locations: client/app/page.tsx:225, client/components/search-form.tsx:31 and :39, client/components/universal-capture-area.tsx:182, client/components/ui/button.tsx:23. Suggested command: $impeccable adapt.

2. **[P1] Replace the ambiguous amber dot.** The visible 8×8 dot conflates actionable failures, unsupported sources, incomplete organization, metadata-only evidence and PDF coverage. Show short visible availability labels and distinguish ordinary limitations from problems requiring action. Preserve the domain distinction between Ready, partial coverage and organization condition. Locations: client/components/knowledge-item-card.tsx:18 and :43. Suggested command: $impeccable clarify.

3. **[P2] Bring the workspace above the fold.** At 1280×720 first-card images begin around y=548 and titles fall below the viewport. Use a compact header for populated vaults, reserve explanatory hero treatment for first use, and omit empty notice spacing. Locations: client/app/page.tsx:194 and :207; client/components/universal-capture-area.tsx:180. Suggested command: $impeccable distill.

4. **[P2] Make cards explain why the information mattered.** Publisher descriptions currently outrank recognition summaries, producing generic promotional copy. Prefer current, evidence-qualified summaries where available; keep metadata-only previews clearly differentiated and surface saved context when useful. Locations: client/components/knowledge-item-card.tsx:47 and client/components/knowledge-item-details.tsx:40. Suggested command: $impeccable shape.

5. **[P2] Reveal effortless capture before opening Add.** Place “Paste a link or drop files” near a clearly labeled capture action and bounded drop surface. Keep Add as the explicit path and explain file support before selection. Locations: client/components/universal-capture-area.tsx:136 and :182; client/app/page.tsx:275. Suggested command: $impeccable onboard.

## Cognitive load and emotional journey

Moderate cognitive load: hierarchy and progressive disclosure fail two of eight checks. Grouping, focus, continuity, and bounded choices generally work; no problematic action decision point above four observed. Eleven retrieval cards do not automatically constitute option overload. Entry feels calm but promotional. Unexplained dots and hidden capture shortcuts introduce uncertainty. Opening details restores trust through substantive evidence. Actual asynchronous completion was not exercised.

## Persona red flags

- Alex, power user: repeated hero consumes working space; paste/drop accelerators and shortcuts are not discoverable.
- Jordan, first-timer: warning dots and the Search/Ask distinction require interpretation; Add gives little advance capability guidance.
- Casey, mobile user: narrow search hides meaningful input, small controls hamper taps, and useful item text begins low in the first viewport.

## Minor observations

- Trash recovery is hidden in a board ellipsis (client/app/page.tsx:250).
- Publisher imagery dominates board/detail without necessarily helping recognition (client/components/source-preview.tsx:18).
- Ask can express the benefit as local processing rather than exposing “Ollama” (client/components/ask-panel.tsx:35).
- Persistent card menus provide alternatives to hover shortcuts; those shortcuts were not deemed inaccessible merely because initially hidden.

## Question to consider

Why does a tool for remembering ideas devote more first-screen space to publisher branding than to the reason something was saved?

## Evidence limits

Viewport resizing is not touch emulation. Model responses, upload completion, destructive actions, contrast measurements and screen-reader operation were not tested. Source-based findings about those paths remain provisional.
