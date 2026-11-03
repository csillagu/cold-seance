---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-207: GitHub access may use one App per function

The tool may use a separate GitHub App for each of its functions on GitHub: reading issues, writing to issues, and the Projects status field. It may also use one App for all of them, by giving the same App for every function. Each App is given by its id and its private key.

As received, in the design session of 2026-11-02, asked who may use the GitHub App setup page: "one app per function can be used (or the same if the same secret is entered into all fields)".

As received, in the design session of 2026-11-03, asked whether the functions are separate Apps for reading issues, writing to issues and the Projects status field, and whether the fields are the App id, private key and webhook secret: "fields are app id, private key, why would webhook be relevant? Your take on functions is correct".
