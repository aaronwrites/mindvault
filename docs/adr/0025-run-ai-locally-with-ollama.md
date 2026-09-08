---
status: accepted
---

# Run AI locally with Ollama

Use local Ollama models for Recognition Summaries, Topic Tags, Synthesis, and
semantic embeddings, replacing the initial Gemini adapters described in
ADR-0021 while preserving its provider-neutral boundaries and data-minimization
intent. Use Gemma 3 for generation and Nomic Embed Text for 768-dimensional
document/query embeddings. Store the exact embedding model digest and prefix
policy in compatibility metadata so changed representations are never compared.
Do not fall back to a cloud provider.

Local inference trades cloud disclosure and API quotas for machine-level model
availability, slower processing, and explicit context limits. Workers therefore
renew stage leases during inference, and generation rejects inputs above a
conservative 28,000-byte ceiling instead of silently omitting evidence.
