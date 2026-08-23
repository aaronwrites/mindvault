# Separate item availability from Processing Attempt outcome

MindVault tracks Knowledge Item availability independently from each Processing Attempt's outcome. An item with an indexed representation remains Ready during refreshes and after refresh failures, while unsupported Sources are distinguished from operational failures; this prevents transient processing events from incorrectly erasing the user's durable ability to recall an item.
