# Use Cloudinary for Original File storage

MindVault stores Original Files as authenticated Cloudinary assets behind a narrow provider-neutral storage boundary. Cloudinary supplies managed binary storage and media capabilities useful to later PDF, image, audio, and video adapters, while authenticated delivery keeps originals and derivatives private; PostgreSQL remains authoritative for Source identity, Capture provenance, storage state, and cleanup work so Cloudinary-specific locators do not become the knowledge model.
