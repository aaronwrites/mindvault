# Keep access single-user

MindVault remains a single-user system rather than adopting speculative multi-tenant ownership and account concepts. The ingestion milestone may run locally or privately, while any public deployment and browser capture client must use lightweight single-user authentication with revocable API credentials; server-side URL fetching remains subject to SSRF and resource limits even for an authenticated user.
