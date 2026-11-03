---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-229: GitHub access may use personal access tokens beside Apps, mixed

The tool must allow personal access tokens to be used for its access to GitHub instead of GitHub Apps ([SRC-228](SRC-228-some-companies-do-not-allow-github-apps.md)). Both are options. Tokens can be as granular as Apps are ([SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)), and Apps and tokens can be mixed.

As received, in the design session of 2026-11-03: "We need to allow the use of personal access tokens, instead of apps. Both should be an option, it can be similalry granular, moreover the two can be mixed." The reason given with it is recorded in SRC-228.

"Similarly granular" is read as the granularity SRC-207 gives Apps: a separate token for each of the tool's functions on GitHub, or one token for all of them. "Mixed" is read as some functions given an App and the others a token. Both readings are Claude's.

Asked later in the same session whether "similarly granular" also means that a token's permissions and repositories are limited to what its function needs, as an App's are, and whether Apps and tokens can also be mixed by repository, the owner answered "1 yes". Asked then which of the two the "yes" covered, the owner chose, for token scoping, "Yes, both parts": a token may be limited to the permissions its function needs and to selected repositories, and the tool must work with such a token. For mixing, the owner chose "No per-repo mixing": Apps and tokens are mixed by function only, and one function uses either an App or a token on every repository. This confirms the reading of "mixed"; reading "similarly granular" as one token per function or one for all awaits the owner's confirmation.
