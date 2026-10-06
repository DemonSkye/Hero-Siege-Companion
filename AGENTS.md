# Hero Siege Companion — app contract

Read this file for routine app work. It is the canonical contract; long workspace
history is optional context. This Electron + Vue app tracks Hero Siege runs using
passive Npcap capture and focused, explicit product actions.

## Work toward an accepted user outcome

- Define the user journey and observable acceptance before implementation — this
  keeps a successful probe from being mistaken for a completed product.
- Keep a short evidence ledger: observed facts, assumptions, named blocker, next
  discriminating check and result — decisions should be traceable without a transcript.
- Reuse working code and retained fixtures/captures; choose the cheapest safe
  experiment that distinguishes plausible causes — avoid reconstructing solved work.
- Reverse-engineer only a named blocker; retain coherent useful exports and label
  assumptions separately from observed protocol requirements — arbitrary past caps
  and speculative wire rules must not become global policy.
- Report failures on the first attempt with safe stage, reason and relevant counts;
  exclude sensitive values — useful evidence reduces repeated low-information runs.
- Review proportionally to risk and reassess after repeated low-information
  iterations — optimize elapsed time to a trustworthy outcome.

## Find the owner and keep boundaries clear

- Inspect Git status and preserve unrelated edits — the owner may be testing them.
- Use the current local Graphify map before broad code/file searches. Refresh
  whenever stale or needed, with a separate output for each worktree; code-only
  extraction and no provider labels keep discovery local. Verify material graph
  leads against the smallest source/test surface and, when available, the outer
  `CODE_EXPLANATION.md` owner section — inferred edges are leads, not proof.
- Exact searches are appropriate for graph blind spots (Vue templates, CSS,
  strings, configs, package scripts, generated assets and dynamic IPC), or to
  confirm a graph lead. If Graphify is unavailable, read its JSON/report and state
  the limitation — do not silently substitute a broad search. If no map/tool is
  available, report that and inspect focused source/contracts; do not implicitly
  install tooling or use a provider.
- Keep `src/main/main.ts`, `src/main/capture.ts` and `src/renderer/src/App.vue`
  as coordinators. Extend the focused owner first — wiring should stay readable.
- Main owns filesystem/dialog/native/network lifecycles; `src/shared` owns pure
  contracts/parser/stats; renderer `lib` owns reusable state/projections and
  components own presentation. Shared code imports neither main nor renderer;
  renderer uses the typed preload API — these boundaries enable isolated tests.
- Prefer a small concrete simplification over a framework or size target;
  remove indirection only after confirming callers and runtime blind spots —
  file length and isolated graph nodes do not prove complexity or dead code.

## Honest readiness and experiments

| State | Meaning | Explanation / action required |
| --- | --- | --- |
| Waiting | Prerequisite evidence has not arrived; no request is in flight. | Name the missing prerequisite and the supported way to obtain it. |
| Ready | Current prerequisites permit the explicit action now. | Name the action; keep observation age, provenance and cooldown separate. |
| Refreshing | An explicit request is in flight. | Explain progress and supported cancellation/wait behavior. |
| Failed | An attempted operation ended unsuccessfully. | Give a safe reason and concrete recovery/retry condition. |
| Unavailable | The action cannot currently be supported. | Name the blocker and a supported remedy, or say none is established. |

- Apply these meanings in touched owners without inventing enum migrations —
  labels cannot promise readiness that dispatch validation does not support.
- Keep experimental controls outside normal workflows with an explicit promotion
  or removal decision — a completed diagnostic probe is not product acceptance.
- Every temporary constraint names its scope and endpoint — historical task limits
  expire with that task and do not grant permissions for later work.

## Verify and hand off

- Add/update representative regressions at the riskiest changed boundary. Use
  packet/message/persisted/preload/UI-shaped fixtures and meaningful negative cases;
  counts alone do not demonstrate correctness.
- Run focused specs first. For non-trivial code changes run `npm test`,
  `npm run typecheck` and `npm run build`. Add deterministic mocked Electron
  checks for shell/preload/IPC/window/cross-process changes that unit tests cannot
  prove — distinguish mocked/offline proof from real Windows/game acceptance.
- Native ABI work uses `npm run rebuild` (the cap lifecycle patch precedes rebuild)
  — direct electron-rebuild bypasses a required safety fix.
- Refresh the relevant branch map after source changes; update affected ownership,
  commands and current handoff docs — stale state increases the next task's cost.
- Report outcome, exact commit/source paths, checks, limits and grouped unresolved
  decisions before scratch notes — another agent must be able to continue safely.

## Security and consequential actions

- Keep authentication/session bodies, identifiers and endpoints in their approved
  main-process boundary; logs/IPC/support exports use safe allowlisted projections
  — diagnostics must not leak credentials or private protocol data.
- Keep private research, original captures, permissioned experiments and internal
  release workflows outside app Git unless explicitly approved for publication —
  app documentation is distributable.
- Packaging, previews/dev servers, screenshot/visual loops, live capture,
  authentication, installed-game access and research execution require explicit
  task authorization — automated verification does not authorize live operations.
- Release/push/publish require explicit authorization, confirmed destination/account
  and recorded Windows/Npcap/game UAT; use the private release checklist when
  available — automated builds alone cannot prove native release readiness.
- Do not bypass denied actions, silently broaden consequential scope, discard
  original evidence or permanently delete ambiguous artifacts — report the exact
  action, target and blocker and continue independent work.
