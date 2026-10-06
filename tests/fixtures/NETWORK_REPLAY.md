# Traffic replay evidence

`network-replay-evidence.json` records a small allowlisted projection of retained
evidence. `network-replay.ts` substitutes all sign-in values, addresses, identifiers,
tokens, counters and packet bytes. These are evidence-backed journey tests, not a
literal replay of a recorded authenticated session.

| Evidence | What is retained | What is substituted or missing |
| --- | --- | --- |
| Redacted September 4, 2026 Market observer summary | Search mask, default sort 0 and cursor fields; one complete request summary | No paired response. Authentication and endpoint are omitted. Product sort 2 is an intentional lowest-price choice supported by the observed differential, not the captured default. |
| September 16 passive SZ packet metadata | Ethernet, flags 24, 188 payload bytes, 242 packet bytes, untruncated | Original packet bytes unavailable here. Zone JSON and headers are invented and padded to the observed payload geometry. |
| October 6 initialized-SZ success report and inspected transport | Connect acknowledgement opcode 0x1000, initialization order and represented operands | Complete startup/login capture is unavailable. Connect/PostLogin/login-success bytes are invented; split/reordered/duplicated TCP segments are added test conditions. |
| October 6 Market diagnostics | Three HTTP 200/application -3 checksum rejections; 40-byte responses | Original rejection text is unavailable. The JSON fixture substitutes a safe `checksum` message; its byte length is not claimed to reproduce the original. |
| Owner-reported vote reset and manual Refresh | One successful manual Refresh after the vote reset | Running build and Ready origin unknown; no wire trace establishes exactly what the game emitted. The test supplies a fresh coherent initialization as a conditional model, not a guarantee about that game action. |

`sz-market-replay-acceptance.spec.ts` uses real Ethernet/TCP decoding, bounded
reassembly, session-field extraction, Market readiness, SZ preparation/controller,
owned request framing/response validation, Market request construction and response
reduction. Native capture/process/build lookups, sockets, launch and the worker
boundary are mocked. Saved-pair encryption is the explicitly fake test cipher;
no OS encryption or server authentication is exercised.

The journeys cover listener-before-launch and Ready without sending, late attach
and fresh initialization, repeated explicit Refresh, encrypted
fixture persistence across Companion disposal/reopen with fresh parsed identity,
SZ then Market in one Companion and after reopen, and an incomplete TCP message
that must not manufacture Ready. The production CaptureService/main/IPC/UI wiring
has separate mocked Electron regressions; this composed test is not a live capture.

One `test.fails` records an unresolved startup display defect: before gameplay
capture starts, the private initialization listener reaches Ready but does not
forward the initial passive SZ to the display. The passing launch test checks
Ready and explicit Refresh, not that missing passive update. Fixing that defect
must turn the expected failure into an ordinary passing assertion. No readiness
correction or owner vote-reset success is presented as fixing the on-load display.

Inventory found the redacted Market summary and packet metadata, but no pcap/pcapng/
HAR or complete Connect/PostLogin exchange in the relevant retained research/debug
folders. The old paired Market capture directory was absent. Sanitization emitted
only the public search fields and packet metadata; originals were preserved. Future
complete recordings can replace the marked substitutes without changing the real
parser/readiness assertions. These tests prove the supplied traffic is handled;
they do not prove startup capture sees every login, cache reuse is accepted by the
server, or that SZ caused the independently observed Market rejection.
