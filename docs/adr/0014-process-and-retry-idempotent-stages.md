# Process and retry idempotent stages

Extraction, Passage generation, retrieval indexing, Recognition Summary generation, and Topic Tag generation run as separately observable, idempotent stages. Transient failures receive bounded automatic retries of only incomplete work; when organization retries are exhausted, a retrievable item remains Ready with an Organization incomplete warning and manual retry rather than silently succeeding or looping forever.
