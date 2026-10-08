# BluePrint — Test Plan Status

How each test case from the SRS (§5, T1–T53) is covered. **Auto** means it runs in `npm test` (vitest, plain Node, a stand-in `vscode` module backed by real temp folders). **Manual** means it needs the VS Code UI or a real LLM; run those in the Extension Development Host (F5) using the projects in `test/`.

```
npm test            # 104 unit tests, ~3 s
npm run typecheck   # extension + test sources
```

## Coverage by SRS test case

| ID | Case | How | Where / notes |
|---|---|---|---|
| T1 | Extension activates on startup | Manual | |
| T2 | Sidebar hidden before init | Manual | |
| T3 | Sidebar appears after init | Manual | |
| T4 | Status bar state transitions | Manual | Idle click now opens the Hub; Violation rebinds to Review |
| T5 | Save/retrieve provider credentials | Auto | `llm.test.ts` |
| T6 | No provider blocks a workflow | Auto + Manual | `fromSecrets` → null in `llm.test.ts`; error message in UI is manual |
| T7 | Gemini routing | Auto | `llm.test.ts` — key now sent in `x-goog-api-key`, not the URL; model is now `gemini-flash-latest` (the SRS's `gemini-2.0-flash` was shut down by Google) |
| T8 | Anthropic routing | Auto | `llm.test.ts` |
| T9 | OpenAI-compatible routing | Auto | `llm.test.ts` (OpenAI, Groq, OpenRouter) |
| T10 | Non-OK response → actionable error | Auto | `llm.test.ts`, plus 429/5xx retry and wizard key validation |
| T11 | Architecture from a clear description | Auto (parsing) + Manual (LLM quality) | `agents.test.ts` |
| T12 | No hallucination on a vague description | Manual | Depends on the model; prompt rule in `archPrompts.ts` |
| T13 | Blueprint persisted correctly | Auto | `archmd.test.ts` |
| T14 | Malformed JSON on generation | Auto | `agents.test.ts` |
| T15 | Re-running init | Auto + Manual | Snapshot to history in `archmd.test.ts`; confirm dialog is manual |
| T16 | Concrete answer → draft ADR | Auto | `agents.test.ts` |
| T17 | Tentative answer → no ADR | Auto | `agents.test.ts` |
| T18 | Empty answer skips the LLM | Auto | `agents.test.ts` |
| T19 | Skip button | Auto + Manual | `ElicitationSession.skip` in `decisions.test.ts` |
| T20 | All questions, mixed answers | Manual | Now up to 10 questions (5 topics + follow-ups, D5) |
| T21 | Structural signals from a diff | Auto | `diff.test.ts` — Tree-sitter against a real git repo, and regex fallback |
| T22 | package.json dependencies | Auto | `diff.test.ts` — also requirements.txt, go.mod; scripts/comma-only changes ignored |
| T23 | Signal list truncation | Auto | `diff.test.ts` |
| T24 | Large diff truncation | Auto | `diff.test.ts` — now a 6,000-char excerpt shared by both passes; every file stays named, long files are cut with a note |
| T25 | No git repo / no diff | Auto + Manual | `diff.test.ts`; "No uncommitted changes" screen is manual |
| T26 | Short-circuit when ADRs ≤ top-K | Auto | `retrieval.test.ts` |
| T27 | Top-K ranking | Auto | `retrieval.test.ts` |
| T28 | Component-name boost | Auto | `retrieval.test.ts` |
| T29 | Embedding cache reuse | Auto | `retrieval.test.ts` |
| T30 | Fallback to TF-IDF | Auto | `retrieval.test.ts` |
| T31 | Query from diff | Auto | `retrieval.test.ts` |
| T32 | Diff violates a locked ADR | Auto (parsing) + Manual (LLM judgment) | `agents.test.ts` |
| T33 | Minor convention deviation | Manual | LLM judgment |
| T34 | Clean diff → Pass 2 | **Changed (D1)** | Both passes now run in parallel on every review |
| T35 | Unparseable compliance output | Auto | `agents.test.ts` |
| T36 | Save decision as ADR | Auto + Manual | `decisions.test.ts` (one ADR per violation, D2); panel is manual |
| T37 | New component detected | Auto (parsing) + Manual | `agents.test.ts` — now a list of extensions (D2) |
| T38 | Route/method addition not flagged | Manual | LLM judgment |
| T39 | Extension confirmed | Auto + Manual | `decisions.test.ts` (ARCH.md row added on approval) |
| T40 | Extension dismissed | Manual | |
| T41 | Sequential padded IDs | Auto | `decisions.test.ts`, including concurrent creates |
| T42 | Filename slugification | Auto | `decisions.test.ts` |
| T43 | Update rewrites index + markdown | Auto | `decisions.test.ts`, including rename on title change |
| T44 | Click-to-open from sidebar | Manual | |
| T45 | Intent conflicts with a constraint | Auto (parsing) + Manual | `agents.test.ts`, incl. suggested revised prompt |
| T46 | Intent with no conflicts | Auto (parsing) + Manual | `agents.test.ts` |
| T47 | Pre-check blocked when uninitialized | Manual | |
| T48 | Ctrl+Enter triggers check | Manual | |
| T49 | Check another prompt | Manual | **Changed**: "Revise prompt" keeps the text, "Check another prompt" clears it |
| T50 | Singleton panels | Manual | |
| T51 | Audit trail empty state | Manual | |
| T52 | Audit trail sorted newest first | Manual | Sorting is done by the host before sending |
| T53 | Ready-signal handshake | Manual | |

## Beyond the SRS test plan

| Area | Auto coverage |
|---|---|
| Role lookup, approval queue (SRS 3.2.5) | `decisions.test.ts`: no manifest ⇒ Architect; Developer proposals wait; only Architects approve; rejection needs reasoning and never touches ARCH.md |
| Non-destructive ARCH.md patching (SRS 2.2) | `archmd.test.ts`: manual edits preserved byte-for-byte, widened tables, CRLF, duplicates are no-ops |
| ARCH.md history and revert (SRS 2.1) | `archmd.test.ts`: snapshot before each change, revert is itself reversible |
| Viewer highlights (SRS 3.1, D6) | `archmd.test.ts`: last 5 changes, whole-document changes |
| Add Decision (D11) | `agents.test.ts`: draft parsing, replaced-id normalization, tentative flag, fallback draft; `decisions.test.ts`: new constraint, Architect replacement retires the old ADR and swaps its ARCH.md line, Developer replacement waits for approval, only accepted ADRs can be replaced, superseded ADRs leave review context; `archmd.test.ts`: `replaceConstraint` |
| Wizard follow-ups (D5) | `decisions.test.ts`, `agents.test.ts` |
| Pre-check context block (SRS 3.3.1 step 5) | `retrieval.test.ts` |
| Regenerate from codebase (R4) | `snapshot.test.ts`, `agents.test.ts` (constraints never dropped) |
| Reviewable files | `diff.test.ts`: `.blueprint/`, `docs/adr/`, `docs/ARCH.md`, lockfiles excluded |
| Diff summary by file kind | `diff.test.ts`: added / modified / renamed / deleted files (incl. a real `git mv` and deletion), removed dependencies (a version bump is not a removal), deleted manifests; `agents.test.ts`: both passes get the same change description and excerpt |

## Manual checklist (Extension Development Host)

Run with F5, then open one of the projects in `test/`. A free Gemini or Groq key is enough.

**Setup**
- [ ] A fresh folder: status bar shows "BluePrint: Not initialized"; the sidebar views are hidden (T1, T2). No BluePrint button in the editor tab bar.
- [ ] Before init, "BluePrint: Open Hub" shows only an "Initialize BluePrint" card, which opens the wizard. Leave the Hub open: once ARCH.md is generated it switches to the normal cards, and the editor tab bar gets the Hub button.
- [ ] Hub after init: header shows your email and role; four cards (Review my changes, Pre-check a prompt, View architecture, Add a decision) and links (Audit trail, Team & roles, Change LLM provider) each open the right thing. With a pending decision a yellow banner shows the count ("needs your approval" / "waiting for an Architect") and opens the ADR Browser; approving it removes the banner while the Hub stays open.
- [ ] Initialize: an invalid key shows "…rejected this API key"; a valid key moves on; "Get a key ↗" opens the provider's page.
- [ ] Generate the architecture; the sidebar appears (T3).
- [ ] Answer a concrete constraint ("We use PostgreSQL"): if a follow-up is asked, it comes **before** any draft. Answer it ("Redis only as a cache"): one draft "Based on both of your answers" that mentions both. Save with an empty title → inline error.
- [ ] Skip a follow-up (or answer "not sure"): the draft from the first answer is offered ("Based on your first answer only"). Each topic produces at most one ADR.
- [ ] Re-run Initialize: a confirmation dialog appears; after confirming, Revert ARCH.md lists the old version (T15).
- [ ] BluePrint: Change LLM Provider / API Key (palette or ADR Browser "…" menu): the current provider is marked; the key icon opens the key page; a bad key shows the error inline and keeps the box open; a good key saves and the next review uses the new provider. Escape while checking saves nothing.

**Add Decision**
- [ ] Close the wizard right after ARCH.md is generated. Sidebar **+** (or Hub → Add Decision) → "Answer the guided questions instead" reopens just the questions; ARCH.md is not regenerated.
- [ ] Add Decision: `Uploaded files go to Amazon S3, not local disk.` → draft, "No — this is a new decision" preselected; save → new constraint in ARCH.md.
- [ ] Add Decision: `Checkout must now offer both Stripe and PayPal.` → suggests replacing the Stripe ADR with a reason; save → old ADR shows "replaced by ADR-…" in the sidebar, ARCH.md line swapped, viewer highlights Constraints.
- [ ] Add Decision: `Maybe we'll add Redis someday.` → tentative warning, still editable and savable.
- [ ] As a Developer: a replacement is pending; the old ADR and ARCH.md change only after approval.

**Compliance review**
- [ ] Add a file that contradicts an ADR (e.g. a MongoDB client) and a new self-contained module, then Review: violations and new components appear together (D1).
- [ ] Resolve two violations separately with "Update Architecture": two ADRs (D2). "Modify Code" records none.
- [ ] Register one component, dismiss another (T39, T40). The ARCH.md viewer highlights Components.
- [ ] Planned vs implemented (D13): a fresh Initialize shows every component as "Planned" in ARCH.md's Status column. An older ARCH.md (no Status column) gets the column on its first component change, existing rows "Planned".
- [ ] test5 (`notifications.ts`, `hello.py`): Review → `notifications.ts` is a **new component**; `hello.py` is under "Checked, not new" with a reason. Register the extension: one ADR, and ARCH.md shows it as "Implemented — `notifications.ts`".
- [ ] Add code that *is* a planned component (e.g. a React `App.tsx` for a planned Frontend): it shows under "Planned components now in code". "Mark as Implemented" → ARCH.md row says "Implemented — `src/App.tsx`", **no ADR**, an audit entry "Component implemented", and Revert ARCH.md can undo it. Works as a Developer too.
- [ ] "It's a New Component Instead" on a planned match, and "Register as new component anyway" on a checked file: a small form (name pre-filled from the file); registering creates the ADR as for a detected extension.
- [ ] A new file next to an implemented component's code: "Checked, not new", naming that component.
- [ ] Create a new file: the review prompt appears once even for several files (debounced).
- [ ] After a review with violations, click "Violation" in the status bar: the open Compliance panel comes to the front with no new review. Close the panel and click again: the review re-runs in the same mode.
- [ ] Resolve every violation in the panel (any mix of "Update Architecture" and "Modify Code"): the status bar goes back to "BluePrint" without a new review.
- [ ] Review with nothing changed (commit everything first): "No uncommitted changes" with a working "Check again" button. In a folder that isn't a git repo: "This folder is not a git repository". In a folder an outer repo ignores: "Git is ignoring this folder", naming that repo.
- [ ] Open a subfolder of a larger repo (e.g. a package in a monorepo) and change a file in it and one outside it: the review lists only the file inside, with paths relative to the folder.

**ADR Browser**
- [ ] Filter ADR Browser → `postgres`: the banner reads `Filter: "postgres"` with a dimmed "click to clear", and a Clear-filter button appears in the view title. Either one clears the filter and the button disappears.

**Roles**
- [ ] Fresh project without `roles.json`: the wizard shows "Team & Roles" as step 2 with your git email. "A team" with an invalid email → inline error; valid → `.blueprint/roles.json` written, next screen says "you are an Architect".
- [ ] Re-run Initialize with `roles.json` present: the roles step is skipped and the description screen names your role.
- [ ] Unset git email in a fresh project (`git config --local user.email ""`): only "Skip" is selectable; set it, "Check again" enables the others.
- [ ] Status bar tooltip and the ADR Browser title show your role.
- [ ] BluePrint: Configure Team & Roles → panel; add a Developer and save. Edit `roles.json` by hand to make yourself a Developer: within a second the sidebar title says "You: Developer", Approve/Reject buttons disappear, pending items say "waiting for an Architect", the viewer's Revert and Regenerate are disabled, and "Revert ARCH.md" is gone from the command palette.
- [ ] As a Developer: your next decision is pending (sidebar + status bar count); ARCH.md is unchanged. Initialize is refused, naming the Architects; the roles panel is read-only.
- [ ] Back as Architect: approve and reject from the sidebar's inline buttons; rejection requires a reason.
- [ ] Simulate a teammate: edit `.blueprint/adr-index.json` (or `git pull` an approval) → the sidebar updates without reloading.

**Pre-check**
- [ ] Prompt that conflicts with a constraint: concerns + suggested revision; "Use this prompt" fills the box (T45).
- [ ] "Copy prompt with context" → paste: prompt + selected ADRs + constraints.
- [ ] Ctrl+Enter checks (T48); "Revise prompt" keeps text, "Check another prompt" clears it (T49).

**Viewers**
- [ ] Audit trail: Decisions newest first, search by file name, Activity filters; it updates while open (T50–T53).
- [ ] Sidebar "Audit Trail": the latest reviews, pre-checks, decisions and ARCH.md changes (not the ADR list), newest first, updating as they happen. A decision entry opens its ADR; others open the full trail; the history icon in the view title opens it too.
- [ ] ARCH.md viewer: recent sections highlighted; Edit source / Revert / Regenerate; edits to ARCH.md re-render.

**Packaging**
- [ ] `npm run package`, then install `out/blueprint-<platform>.vsix` in a normal VS Code window; the first pre-check downloads the model once (~23 MB), later ones work offline.
