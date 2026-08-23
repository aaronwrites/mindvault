# Use PostgreSQL for background work

MindVault uses PostgreSQL as both the authoritative Processing Attempt ledger and the durable work queue for the first asynchronous pipeline, with a separate worker claiming leased work and applying bounded retries. BullMQ with a visible enqueue-failure fallback would be acceptable at current scale, but still adds Redis and leaves rare crash-window reconciliation to solve; PostgreSQL permits Capture and initial scheduling in one transaction and is sufficient until real throughput, latency, or cross-service requirements justify another queue system.
