---
certainty: verified
source: design session
evidence: design session 2026-11-27; GitHub issue 274
---

# SRC-298: Sign-in attempts are limited per client address, and at most four password checks run at once

Sign-in is limited in two ways. Each client IP address may make 10 sign-in attempts in any 60 seconds; an attempt with 10 before it in the 60 seconds before it is refused with 429. Only attempts that went on to a password check count. At most 4 password checks run at once across the server; a sign-in over that cap is refused with 429 straight away and can be retried. The client address is the address the request comes from, unless a new configuration setting, off by default, tells the server to trust the `X-Forwarded-For` header from the reverse proxy. When sign-in is refused for too many attempts, the sign-in page says: "Signing in failed: too many attempts. Wait a minute and try again."

As received, in the design session of 2026-11-27, after Claude reported that password sign-in is reached without being signed in, runs Argon2id with 19 MiB of memory for each attempt, and limits nothing:

- Asked what should limit sign-in, offered per client IP, a cap on concurrent password checks, and per username: "Per client IP (Recommended), Concurrency cap (Recommended)". Per client IP was offered as "Count sign-in attempts from each IP address; refuse with 429 past the limit."; the cap as "At most N password checks run at once server-wide; extra requests wait or get 429. Bounds memory regardless of attacker count."
- Asked how many sign-in attempts per IP, in what window: "10 per minute".
- Asked how the client IP is found behind a reverse proxy: "Opt-in setting (Recommended)", offered as "A new config setting (off by default) tells the server to trust X-Forwarded-For from the proxy; without it, the socket address is used."
- Asked how many password checks may run at once, and what happens to a sign-in over the cap: "4 at once, extra get 429 (Recommended)", offered as "A sign-in over the cap is refused straight away and can be retried."
- Asked what the sign-in page shows when sign-in is refused for too many attempts: "New message (Recommended)", offered as "\"Signing in failed: too many attempts. Wait a minute and try again.\" Same alert box as the other failures."
- Asked whether an attempt refused with 429, by either limit, counts toward its address's 10: "No, only checked ones (Recommended)", offered as "Only attempts that went on to a password check count. Someone who keeps retrying while refused is let in again a minute after their 10th checked attempt."
- Asked how "10 per minute" is measured: "Last 60 seconds (Recommended)", offered as "Refused when 10 attempts fall in the 60 seconds before this one (sliding window). No burst of 20 across a minute boundary."
