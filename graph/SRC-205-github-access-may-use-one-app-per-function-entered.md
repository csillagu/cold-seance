---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-205: GitHub access may use one App per function, entered by hand

The tool may use a separate GitHub App for each of its functions on GitHub: reading issues, writing to issues, and the Projects status field. It may also use one App for all of them, by entering the same App in every function's fields. Each function's fields are the App's id and its private key. Entering an App by hand, instead of creating it from the tool, must be an option.

As received, in the design session of 2026-11-02, asked who may use the GitHub App setup page: "one app per function can be used (or the same if the same secret is entered into all fields)".

As received, in the design session of 2026-11-03, asked whether the functions are separate Apps for reading issues, writing to issues and the Projects status field, whether the fields are the App id, private key and webhook secret, and whether entering them by hand replaces the one-click creation: "typed by hand must be an option, fields are app id, private key, why would webhook be relevant? Your take on functions is correct".

"Must be an option" is read as: entering by hand is offered beside creating the App from the tool, not instead of it. The owner asked why the webhook secret would be relevant; whether an App entered by hand also needs its webhook secret is not settled.
