# Store textual knowledge in PostgreSQL and defer object storage

The public textual URL milestone stores cleaned Source Snapshots, Passages, hashes, metadata, and retrieval indexes in PostgreSQL with pgvector. MindVault will add object storage only when an adapter owns binary content such as uploaded PDFs, images, screenshots, or other files, and will choose a provider from those requirements rather than carrying forward the legacy Cloudinary commitment.
