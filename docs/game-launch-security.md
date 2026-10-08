# Game launch boundary

`game-executable.ts` owns native selection approval, persistence, executable
inspection and direct process creation. `GameCaptureCoordinator` retains launch
ordering, capture readiness, cancellation and process monitoring. `main.ts`
authorizes the caller and validates the request before invoking either owner.
`MainWindowManager.isTrustedIpcSender` checks the current window, main-frame
identity and configured local renderer document. Preload exposes a typed launch
method containing only the Steam/Standalone boolean and a native Browse method.

The threat model treats renderer JavaScript, localStorage and imported
configuration as untrusted. Renderer compromise must not grant a caller-chosen
binary, command line or shell target. The renderer may request the already
authorized game or the fixed Steam game URL. Only the current app main frame may
invoke game launch, read selection or open the native executable picker. Unknown
fields and extra IPC arguments are rejected; authorization is checked again after
asynchronous preparation and immediately before process dispatch.

Initial standalone approval comes from the user's native file-picker selection,
never from a renderer-supplied path or a familiar filename. Selection accepts a local
drive path to a regular `.exe` with a Windows executable PE header (not a DLL),
resolves its canonical path and records a SHA-256 digest in the main-owned
`game-executable.json` under userData. A new Companion process reads that record;
it never migrates permission from legacy renderer preferences or backups. Each
launch rechecks canonical path and bytes, then calls `spawn` with an empty argument
list and `shell: false`. Spaces in the path remain part of one executable path.
URLs, UNC/device paths, alternate streams, relative paths, scripts and shortcuts
are unsupported. Steam always uses `steam://rungameid/269210`.

This approves an explicit user selection; it does not authenticate the game
publisher. A malicious PE file remains malicious if the user deliberately selects
it. The digest detects replacement since approval, including ordinary game
updates. For changed bytes at the same retained canonical path, a main-owned
native warning offers Cancel (the default) or explicit approval. It shows the
retained path and warns to approve only an intentional installation update. Main
rechecks path, bytes, existing approval and sender/capture authorization after
the dialog, before saving the new digest and dispatching. Cancellation or another
change preserves the old approval; moved/retargeted, missing or invalid files
still require Browse. Concurrent changed-file confirmations are rejected.
This confirmation does not authenticate an update or its publisher.

All renderer-facing Save exports use `electron-dialogs.ts` and its centralized
`export-destination.ts` guard. Native Save consent permits an export; it cannot
write approval records, preferences, other Companion userData, the application
install directory or code,
the running app executable, or the selected game executable. Checks include raw
and canonical containment with path-segment boundaries, Windows case folding,
nearest existing ancestors for new files and junction aliases. Existing hard-linked
destinations are rejected because canonical filenames do not identify all links.
Windows device/namespace paths, alternate streams and ambiguous trailing-dot/space
components are rejected. Ordinary external exports, including overwriting a
regular unlinked file, remain supported. Save/CSV/research/support/soundpack routes
share this guard; export content is never a native executable approval capability.
Browser downloads (`<a download>`, blob/data URLs) are cancelled in `will-download`,
so renderer-chosen bytes cannot reach disk outside these guarded routes.

These boundaries cannot defeat another local process with
the user's filesystem privileges: such a process can alter the approval file or
race the gap between verification and Windows opening the executable. A
compromised renderer can request the approved launch repeatedly or display
misleading instructions around the native picker. Sender authorization also does
not establish a fresh user gesture. Those cases require different OS or product
controls and are outside this renderer-selected execution fix.

Synthetic unit and Electron regressions retain production main/preload/UI glue
while replacing process and shell dispatch before invoking IPC. Invented PE
fixtures are never executed. They cover arbitrary paths/arguments, sender/frame
rejection, native selection, changed-file confirmation/cancellation/races, forged
approval through Save, junction/hard-link export aliases, ordinary exports, legacy
preference isolation, Steam, read-only display and restart. They cannot establish native
game compatibility, publisher identity, or OS behavior under local filesystem
tampering.
