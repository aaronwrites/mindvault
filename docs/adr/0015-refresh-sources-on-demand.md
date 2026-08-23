# Refresh Sources on demand

MindVault refreshes a Source after initial Capture, explicit user request, or a repeated Capture when no successful extraction occurred recently, rather than recrawling on a schedule. Every repeated Capture preserves its new Capture Context, identical content hashes create no Source Snapshot, and meaningful changes create an immutable snapshot followed by refreshed organization and retrieval indexes.
