---
certainty: assumed
---

# FR-185: Call GitHub for each function with the App or the token given for it

The system must call GitHub, for each of its functions there (reading issues, writing to issues and the Projects status field, [SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)), with the GitHub App or the personal access token given for that function, so that Apps and tokens can be mixed across functions and one App or one token can serve several functions ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)).

No use case covers installing the tool; this obligation rests on the linked items directly.

Origin: composed by Claude from the items linked above, for issue #37. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. It awaits the owner's confirmation.
