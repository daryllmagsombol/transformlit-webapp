# Bible Offline Rights Record

## Policy

Offline storage is disabled unless a repository-held or explicitly supplied
license record for that exact translation documents all three permissions:

1. redistribution to end users;
2. persistent/offline storage on a user's device; and
3. format conversion required by the client.

Required attribution must also be recorded and stored with each downloaded
chapter. A provider's description of a translation as "free use" is not
evidence of these grants. General statements that a work is likely public
domain, including the research note in the PWA release checklist, are not an
attached per-translation license record and do not enable a download.

Unknown or incomplete evidence is **disabled by default**. The runtime gate is
translation-specific: missing evidence blocks that Bible translation only and
does not block version-pinned Transformlit book downloads. Bible downloads are
read-only and save only the explicitly selected chapter; they do not fetch a
complete translation, audio, word-study, or cross-reference payload.

To enable a translation, add a reviewed evidence entry to
`apps/web/src/lib/bible/offline-rights.ts` and update this table with the exact
license source and attribution. Do not infer permission from an API response.

## Current evidence state

No per-translation license record granting offline storage, redistribution, and
format conversion is present in this repository or was supplied with Task 6.
Therefore all currently curated translations remain unknown and disabled.

| Translation ID | Curated name | Evidence state | Offline decision | Attribution record |
| --- | --- | --- | --- | --- |
| `BSB` | Berean Standard Bible | Unknown; no attached license record | Disabled | None recorded |
| `ENGWEBP` | World English Bible | Unknown; no attached license record | Disabled | None recorded |
| `eng_kjv` | King James Version | Unknown; no attached license record | Disabled | None recorded |
| `eng_asv` | American Standard Version (1901) | Unknown; no attached license record | Disabled | None recorded |
| `eng_web` | World English Bible Classic | Unknown; no attached license record | Disabled | None recorded |
| `tgl_ulb` | Banal na Bibliya | Unknown; no attached license record | Disabled | None recorded |

The absence of evidence is deliberate, not a claim that these translations are
restricted. It is a fail-closed implementation until an authoritative license
record is added.
