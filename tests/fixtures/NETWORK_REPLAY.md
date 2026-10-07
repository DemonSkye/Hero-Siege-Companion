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
| October 7, 2026 17:03 UTC accepted Companion Market pair | Fetch route and ordered search fields; independently pinned synthetic checksum; 101 numeric prices in received order, with lowest 4,000/6,000 and itemCount 101 | Application-boundary recording, not independent TLS wire/native game capture. `market-accepted-transformed.json` substitutes credentials/address/scope, strips all other listing fields, projects the envelope and recompresses it. The literal body oracle omits the static route signature and checks its independent fingerprint separately. Chunk boundaries and the renderer's catalog drop are invented. |

`sz-market-replay-acceptance.spec.ts` uses real Ethernet/TCP decoding, bounded
reassembly, session-field extraction, Market readiness, SZ preparation/controller,
owned request framing/response validation, Market request construction and response
reduction. Native capture/process/build lookups, sockets, launch and the worker
boundary are mocked. Saved-pair encryption is the explicitly fake test cipher;
no OS encryption or server authentication is exercised.

The journeys cover listener-before-launch, initial passive SZ display and Ready
without sending, late attach
and fresh initialization, repeated explicit Refresh, encrypted
fixture persistence across Companion disposal/reopen with fresh parsed identity,
SZ then Market in one Companion and after reopen, and an incomplete TCP message
that must not manufacture Ready. Native passive SZ during an owned Refresh updates
display while the request remains pending until its owned response arrives. Other
local sockets and packets after an observation gap cannot supply a native update.
The production CaptureService/main/IPC/UI wiring
has separate mocked Electron regressions; this composed test is not a live capture.

The startup display regression is an ordinary passing assertion: only the private
listener is open, and it forwards a strictly parsed SZ from the attributed game
stream before gameplay capture starts. After Ready the same stream observes both
directions and erases complete frames; framed contrary UID/beta invalidates Ready.
Gameplay-only reconfiguration preserves native Ready only while that independent
observer is complete and continuous. Unknown gaps and restored-cache contexts
still suspend. Stream tests send over a MiB across
TCP wrap with a 1 KiB test budget, covering out-of-order/coalesced/overlapping
segments, consumed retransmissions, conflicts and cancellation. Original diagnostic
initialization still keeps its strict coherence/history behavior.

The startup delivery regression composes the production launch coordinator,
Windows capture wrapper, decoder, initialization and cache owners with a buffering
fake adapter and mocked process-query output. Short first-SYN traffic is delivered
before gameplay capture starts. Build lookup uses a current-process path fallback;
safe load/admission/build/cancellation/write stages identify failures without
paths, hashes or authentication fields. Actual main/preload/UI tests also preserve
Ready through gameplay reconfiguration, reject private-only contrary identity,
save and reopen an invented encrypted pair. Synthetic PowerShell checks in the
private workspace shadow every process/file-hash operation; they do not inspect
the installed game or establish actual process-path permissions.

The cache replay saves a coherent invented pair with a mocked build and fake
encryption, disposes Companion with the game flow logically still present, reloads
the file, then receives a newly framed ordinary outbound UID/beta on the current
game-owned flow through the real decoder/reassembler. Matching fresh identity/build
permits cached Ready without a new native login. Only explicit Refresh sends the
pair on a fake owned socket and consumes that socket's fresh identifier/zone.
Reopen with no saved pair, no fresh identity, or UID without beta remains unavailable
and sends nothing. This covers local lifecycle validation, not server reuse of real
credentials, OS encryption, or availability of suitable fresh traffic in owner play.

The accepted Companion pair now has a reusable transformed regression fixture.
`market-private-diagnostic.spec.ts` uses the actual worker entry with mocked HTTPS
to check ordered byte serialization, the independent synthetic checksum and route
signature fingerprint, three test chunks and safe reduction of all 101 prices.
`electron-market-mainline.spec.cjs` reuses the response through production
main/preload/UI for both a fresh profile and a legacy-disabled reopened profile.
Its mock transport calls the real form builder and response reducer; it does not
run the worker thread. The separate worker-entry test covers that boundary. Opening
the dialog sends nothing; one explicit Search displays 101 matches and 4,000/6,000.
The transformed payload is 267 bytes, not the original accepted 8,305 bytes.
Private original-byte replay and sanitization receipts stay outside app Git.
No synthetic credentials or changed payload bytes are claimed to be server accepted.

The earlier startup/SZ inventory found the redacted Market summary and packet metadata, but no pcap/pcapng/
HAR or complete Connect/PostLogin exchange in the relevant retained research/debug
folders. The old paired native Market capture directory was absent. The later accepted
Companion response is not assigned to that historical native request. Earlier sanitization emitted
only the public search fields and packet metadata; originals were preserved. Future
complete recordings can replace the marked substitutes without changing the real
parser/readiness assertions. These tests prove the supplied traffic is handled;
they do not prove startup capture sees every login, cache reuse is accepted by the
server, or that SZ caused the independently observed Market rejection.
