# 20: Generate and canonicalize Topic Tags

**What to build:** Automatic organization assigns reusable subject concepts from actual captured content while keeping retrieval availability separate from organization completion.

**Blocked by:** 16: Recall Knowledge Items through hybrid Passage ranking; 18: Recover Needs attention items through manual retry.

**Status:** complete

- [x] Topic Tag generation consumes Source Snapshot content and Capture Context and stores stable tag identities, canonical display names, and aliases.
- [x] Capitalization, spacing, hyphenation, abbreviations, and known aliases reuse an equivalent Topic Tag, while merely related concepts remain separate.
- [x] Tag generation retries after Ready; exhaustion derives Organization incomplete without changing Ready or looping indefinitely, and manual retry can resume organization work.
- [x] List, detail, and search contracts and the client display Topic Tags and Organization incomplete accurately without presenting tags as Source content.
