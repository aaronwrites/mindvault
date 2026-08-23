# Separate Capture from processing

Capture succeeds as soon as MindVault durably stores the Capture, Source, and Knowledge Item identity, so clicking Save means “MindVault has it” rather than “all processing succeeded.” Extraction, enrichment, and indexing run asynchronously through observable Processing Attempts, while the Knowledge Item exposes the simpler user-facing states Processing, Ready, and Needs attention with retry available after failure.
