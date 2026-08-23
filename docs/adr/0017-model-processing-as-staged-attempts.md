# Model processing as staged attempts

Each initial Capture, Refresh, or manual retry creates a Processing Attempt containing separately observable, dependency-ordered stage work. The worker retries stages independently and the attempt aggregates their outcomes, while Knowledge Item availability and organization completeness are derived from produced retrieval and organization artifacts rather than from one all-or-nothing job status.
