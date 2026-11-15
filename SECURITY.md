# Security

This service is read-only. It stores no user data and returns no credentials.

- Provider credentials (for example `COFACTS_APP_ID`) are supplied only as server environment variables. Never put them in `NEXT_PUBLIC_*`, tool arguments, logs, fixtures, issues or pull requests.
- Text returned by providers is third-party content. Clients should treat it as data, not instructions; items are marked `untrusted: true`.
- Report vulnerabilities through the repository's private vulnerability reporting if enabled, or ask a maintainer for a private channel without including exploit details.
