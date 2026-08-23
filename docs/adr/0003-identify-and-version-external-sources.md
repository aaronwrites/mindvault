# Identify and version external Sources

MindVault treats normalized URLs, declared canonical URLs, and permanent redirects as strong evidence that captures refer to the same external Source. Content similarity may flag possible duplicates but never silently merges distinct Sources; when a Source changes, MindVault retains only meaningfully different cleaned Source Snapshots, deduplicated by content hash, with the newest snapshot current and older snapshots preserved as history.
