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

Standalone approval comes from the user's native file-picker selection, never
from a renderer-supplied path or a familiar filename. Selection accepts a local
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
updates, which require Browse again. It cannot defeat another local process with
the user's filesystem privileges: such a process can alter the approval file or
race the gap between verification and Windows opening the executable. A
compromised renderer can request the approved launch repeatedly or display
misleading instructions around the native picker. Sender authorization also does
not establish a fresh user gesture. Those cases require different OS or product
controls and are outside this renderer-selected execution fix.

Synthetic unit and Electron regressions retain production main/preload/UI glue
while replacing process and shell dispatch before invoking IPC. Invented PE
fixtures are never executed. They cover arbitrary paths/arguments, sender/frame
rejection, native selection, changed bytes, cancellation, legacy preference
isolation, Steam, read-only display and restart. They cannot establish native
game compatibility, publisher identity, or OS behavior under local filesystem
tampering.
