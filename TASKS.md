# BluePrint — Completion Tasks

## ▶ Resume here (updated 2026-10-09)

**State.** All work is committed on branch `complete-srs` (`main` is untouched); `test/` is git-ignored. `npm test` (174 tests), `npm run typecheck` and `npm run lint` pass; `npm run build` and `npm run package` work. Phases 1–4 and 3b are done except the items below.

**Next steps, in order**
1. ~~UI fixes~~ — Phase 3b is complete (U1–U17, 2026-10-08).
2. **Finish the manual checklist** ← *next* in [docs/TESTING.md](docs/TESTING.md) (F5, projects in `test/`). *Partly run* (paused 2026-10-08): the developer tried reviews, the wizard and extension detection, which found M3–M5 (all fixed); no checklist items are ticked yet. Restart the Extension Development Host first so it runs the latest build.
3. ~~**E6** top-K~~ — done 2026-10-09.
4. **E5** non-git diff fallback — present a plan first. (Since M3 the panel already says "not a git repository / run git init".)
5. ~~**P1** README / CHANGELOG / `repository` / icon~~ — done 2026-10-09 (no license, D14).
6. **Publish to the VS Code Marketplace** (D14) after the manual checklist passes: per-platform `vsce publish --target`. Needs the developer's publisher account and token.
7. **P2** update the SRS where behaviour deliberately changed (D1–D13 below; T34 and T49 in particular) and write the project's own ARCH.md (see the `.gitignore` note under P3).
8. *Optional:* let the developer rename a detected extension before registering it (the model's names vary run to run); **F1** under Future extensions.

**Known unverified / caveats**
- Linux and macOS VSIXs build but were never run; only Windows x64 embeddings were verified (from the unpacked VSIX).
- "Regenerate ARCH.md from codebase" has not been tried against a real LLM.
- Rotate the dev API key in `.env` if any build or VSIX from before 2026-10-05 was shared.
- The current dev Gemini key (2026-10-06) is valid but its Google Cloud project gets 403 "Your project has been denied access" on every model, so `gemini-flash-latest` hasn't had a live run. `.env` now uses a Groq key, and every agent passed live on `openai/gpt-oss-120b`.
- Minor: a one-line Python `def f(): pass` keeps `pass` in its signature; an ADR slug cut at 50 chars can end in `-`. Both harmless; changing the slug would orphan existing ADR files.

**Working agreement.** Before each feature: explain the current behaviour and the planned changes, wait for approval, then build → test → commit on `complete-srs`, and record decisions in the Decisions list below.

---

Gap analysis of the SRS (Aug 2026) against the code as of 2026-10-05. `tsc` and the esbuild build pass; the core agents, hub, setup wizard, pre-check, compliance panel and audit trail work. The items below are what's missing or wrong.

Legend: `[ ]` todo · `[x]` done · **SRS** = section/test-case it satisfies.

## Decisions (agreed with the developer)

- **D1 — Pass 1 and Pass 2 run in parallel** on every full review (deviates from SRS 3.2.3 / 3.3.2, which run Pass 2 only when Pass 1 is clean). Violations and extensions are shown together; extensions found alongside violations carry a warning.
- **D2 — One ADR per item.** Each violation is resolved individually (Update Architecture → its own ADR; Modify Code → no ADR). Extension detection returns a list (max 5); each registered extension → its own ADR + ARCH.md component row.
- **D3 — Keep RBAC** (SRS 3.2.5) and **Tree-sitter** parsing (SRS 3.2.3).
- **D5 — Wizard follow-ups.** The 5 topic questions stay; each answer may yield one LLM-generated follow-up (same LLM call as the analysis, max one level deep, so at most 10 questions). *Updated 2026-10-08:* each topic yields **at most one ADR** — when a follow-up is asked, the draft waits for its answer and covers both answers (keeping every concrete fact from each); if the follow-up is skipped or adds nothing, the topic answer's draft is offered instead. Previously a near-duplicate second ADR came from the follow-up.
- **D6 — Regeneration is Architect-only** (a whole-document rewrite doesn't fit the per-ADR approval queue). **Viewer highlights the last 5 recorded changes** (not a time window).
- **D7 — Bring your own key in public builds.** The built-in default key exists only in local dev builds (from `.env`).
- **D8 — Packaging:** one VSIX per platform + universal fallback; embedding model downloaded on first use (not bundled).
- **D9 — Roles are set up during initialization** (new wizard step when there is no `roles.json`; an existing one is used as is). Once Architects are named, only they can initialize/re-initialize or change roles.
- **D10 — No light/heavy model tiers** (drops future_extensions #1): every task is one API call to the configured model; the per-provider model setting covers choosing a cheaper or stronger model.
- **D11 — Add Decision** (2026-10-06): free-text decision → editable ADR draft; it may replace an existing accepted ADR (suggested by the model, chosen by the developer), which is marked superseded and has its ARCH.md constraint swapped on acceptance. Vague text is still drafted, with a warning. The wizard's questions can be reopened on their own.
- **D12 — UI follow-ups (2026-10-08, recommendations accepted):** Hub becomes a state-aware dashboard (U7); the sidebar Audit Trail shows recent audit-log entries (U8); new "Change LLM Provider / API Key" command (U9); Search and Filter ADRs both stay (U10); Revert ARCH.md is Architect-only like Regenerate (U16).
- **D13 — Planned vs implemented components** (2026-10-08). Every component has a status: **Planned** (described, no code yet) or **Implemented** (with its files); ARCH.md shows it in a Status column (older tables get the column on first change, existing rows marked Planned). Initialize marks everything Planned; Regenerate takes statuses from the code. Pass 2 sorts new code into three groups: a planned component now in code → marked Implemented, **no ADR** (it was already decided; open to every role, revertible, audited as `component_implemented`); something neither planned nor implemented → **extension**, one ADR + ARCH.md row marked Implemented; anything else → "checked, not new" with a reason, shown in the panel with "Register as new component anyway". Code counts as a planned component only if it *is* that component as a whole; one capability that a broader planned component merely mentions, built on its own, is an extension (when unsure, extension). The panel lets the developer overrule each verdict.
- **D14 — Release** (2026-10-09): deploy = publish to the VS Code Marketplace, after the manual checklist. No license for now: no LICENSE file, no `license` field, not mentioned in the README.
- **D4 — Orchestrator split kept** (`src/orchestrator/Orchestrator.ts`): pipelines live there, `extension.ts` is UI only.

## Phase 1 — Bugs & correctness (fix before adding features)

- [x] **B1** Auto-trigger on new file is broken: `executeCommand("blueprint.initialized")` calls a context key, not a command, and always rejects. Use `FileStore.isInitialized()`, debounce multi-file creates, add a setting to turn it off. *SRS 3.1, 3.3.2*
- [x] **B2** ~~Pass 2 only if Pass 1 is clean~~ → superseded by D1: both passes run in parallel, deliberately.
- [x] **B3** "Modify Code" resolution currently writes an ADR. Per the SRS it records nothing and just prompts a re-review. *SRS 3.3.2 step 5b*
- [x] **B4** "Update Architecture" only writes an ADR; ARCH.md/arch.json are never updated. *SRS 3.2.4, T36*
- [x] **B5** LLM responses are cast, not validated. A model that returns `{violation:true}` with no `violations` array crashes the webview. Add shape validation with safe defaults in every agent. *SRS 4.3 "defensive parsing", T35*
- [x] **B6** `LLMClient`: no timeout, no 429/5xx retry-with-backoff, crashes on empty/blocked Gemini `candidates`, and the Gemini API key travels in the URL query (and so can land in error text). *SRS T7–T10*
- [x] **B7** `AdrStore` read-modify-write races (`nextId`, and `storeEmbedding` rewrites the index + .md per ADR). Serialize writes with a mutex; store embeddings in the index only. Renaming an ADR title leaves an orphan .md file.
- [x] **B8** `StatusBarManager`: `setOk` timer is never cleared (races with later states) and `setIdle` doesn't reset the command rebound by `setViolationFound`. *SRS T4*
- [x] **B9** Re-running `blueprint.init` on an initialized project silently overwrites ARCH.md. Add an explicit confirm. *SRS T15*
- [x] **B10** Retrieval should consider only `accepted` ADRs (not proposed/rejected/deprecated/superseded).
- [x] **B11** Packaging: per-platform VSIXs (`npm run package` / `package:all`) — win32-x64/arm64, linux-x64/arm64, darwin-arm64 each stage only their onnxruntime binary into dist/node_modules (8–28 MB); a 1.2 MB universal package covers other platforms (Intel Mac, etc.) with lexical-only retrieval. web-tree-sitter bundled, 8 grammars copied to dist/. Quantized model (q8, 23 MB) downloaded on first use into VS Code global storage. Verified: embeddings load from the unpacked VSIX with no node_modules nearby.
- [x] **B13** BluePrint's own artifacts (`.blueprint/`, `docs/adr/`, `docs/ARCH.md`) were included in the reviewed diff and sent to the LLM. *(fixed — `isReviewable` filter)*
- [x] **B14** Webviews used `alert()`, which VS Code webviews block. *(removed everywhere)*
- [x] **B15** No ESLint config existed, so `npm run lint` failed. *(2026-10-08: `.eslintrc.json` — eslint:recommended + typescript-eslint recommended, `_`-prefixed names allowed as unused. The 7 findings fixed: the embedding pipeline is typed; command-argument `any` kept with a scoped disable. `npm run lint` is clean.)*
- [x] **B12** Security: production builds never read `.env`, and fail if the bundle contains anything key-shaped; `.env` (and tests/planning docs) excluded from the VSIX — previously `.env` itself would have been packaged. Public users bring their own key; the wizard links to each provider's key page and validates the key with one request before saving it. *Rotate the current dev key if any build or VSIX was ever shared.*

## Phase 2 — Missing normal requirements (SRS 2.1)

- [x] **R1 Role-based access control** *(SRS 3.2.5)*: identity from `git config user.email`; `.blueprint/roles.json` Roles Manifest (no manifest / no Architect ⇒ everyone is Architect); pending approval queue (ADR `proposed` + "pending approval" badge in the ADR Browser); Architect-only Approve / Reject-with-reasoning commands; auto-approve when proposer is an Architect. Applies to constraint-elicitation ADRs, "Update Architecture", and confirmed extensions. ARCH.md update + embedding generation happen **on approval**.
- [x] **R2 Non-destructive ARCH.md patching** *(SRS 2.2, 3.2.4)*: replace full re-render-from-JSON with targeted section patches (add component row, add constraint bullet, resolve open question) that preserve manual edits.
- [x] **R3 ARCH.md version history** *(SRS 2.1)*: snapshot to `.blueprint/history/` before every patch; "BluePrint: Revert ARCH.md" (pick a version, diff, confirm).
- [x] **R4 Living ARCH.md** *(memory note + future_extensions #3)*: approved ADRs patch ARCH.md (archEffect); "Regenerate ARCH.md from codebase" (Architect-only, diff preview, constraints always kept, revertible).
- [x] **R5 Constraint elicitation** *(SRS 3.1)*: branching dialogue (next question depends on prior answers) instead of a fixed 5-question list; let the developer **edit** a draft before saving. (Keep ≤5–7 questions so T16–T20 still hold.)
- [x] **R6 Tree-sitter diff summarization** *(SRS 3.2.3, Actors)*: parse changed/new files with `web-tree-sitter` (JS/TS/Python/Java/Go grammars) for imports, class/function signatures; keep the current regex path as fallback for unsupported languages.
- [x] **R7 Orchestrator** *(SRS 1.2, 4)*: extract the state machine (`PROJECT_INIT`, `PROMPT_SUBMITTED`, `CODE_GENERATED`, `MANUAL_REVIEW_REQUESTED`) out of the 600-line `extension.ts`; `extension.ts` becomes a thin UI shell. Types for this already exist and are unused.

## Phase 3 — Exciting requirements & UI (SRS 2.3, 3.1)

- [x] **E1 Pre-check "attach ADRs as context"** *(SRS 3.3.1 step 5)*: button that copies the prompt + retrieved ADRs as a ready-to-paste block. Not present today.
- [x] **E2 Decision audit trail** *(SRS 2.3)*: persist `.blueprint/audit-log.json` (`AuditEntry` type exists, unused) for compliance checks, extensions, ADR creation/approval/rejection, ARCH updates; searchable/filterable timeline with links to ADR and the diff summary that prompted it.
- [x] **E3 ARCH.md Viewer** *(SRS 3.1)*: rendered ARCH.md webview; sections touched by the last 5 recorded changes are highlighted with when/why; Edit source / Revert / Regenerate; live refresh.
- [x] **E4 ADR Browser search** *(SRS 3.1)*: search/filter command + status grouping that includes pending/rejected.
- [ ] **E5 Non-git diff fallback** *(future_extensions #4)*: file-manifest snapshot on init; diff against it when the workspace isn't a git repo. *Design proposed 2026-10-08, not approved yet:*
  - **Baseline** stands in for the last commit. It stores file *contents*, not just hashes: Tree-sitter line numbers, removed dependencies and Pass 1 removals need the old text. Format: index (path → hash, size, mtime) plus one copy per distinct content, named by its hash.
  - **Reviews:** git still wins whenever the folder is a repo. Otherwise, walk the files (`listProjectFiles`' walker + skip lists), hash only those whose size/mtime changed, and write **git-shaped unified diff blocks** so everything downstream is unchanged. A deleted file whose content reappears elsewhere is a rename (hash match). Line diffs via the `diff` (jsdiff, MIT) package.
  - **Advancing the baseline:** explicit only — "Mark these changes as reviewed" in the Compliance panel (non-git folders only) and a palette command. Never automatic, or unhandled changes vanish.
  - **Storage:** VS Code workspace storage (`context.storageUri`), outside the project, so BluePrint never touches ignore files (P3). Alternative: `.blueprint/baseline/`.
  - **First baseline** at Initialize in a non-git folder. Projects initialized earlier get a new no-diff reason, "Not tracking changes yet", with a "Start tracking from now" button.
  - **Limits:** skip binary files and files over ~256 KB, cap at 4,000 files, warn above ~20 MB, and list skipped files in the review. Hub and no-diff wording adapted for non-git folders.
  - **Open choices for the developer:** when the baseline advances (explicit recommended), where it is stored (workspace storage recommended), and jsdiff vs a hand-written diff.
  - About a day of work, including tests on a temporary non-git folder.
- [x] **E6 Settings**: `contributes.configuration` for provider/model override, top-K, auto-review on new file. Auto-review on new file; per-provider model override `blueprint.model.<provider>` (2026-10-06); `blueprint.retrieval.topK` (2026-10-09: default 5, 1–20, read per request; one value for compliance Pass 1, pre-check and the ADRs Add Decision offers as replaceable; hand-edited bad values clamped or defaulted). ~~Light/heavy tier~~ dropped (D10).
- [x] **A1 Add Decision** (D11): `BluePrint: Add Decision (ADR)` (sidebar +, Hub card, palette) and `BluePrint: Answer Constraint Questions` (wizard questions without regenerating ARCH.md). New `replace-constraint` ARCH.md effect; ADRs record `supersedes`/`supersededBy`; audit event `adr_superseded`.
- [x] **M2 Diff summary** (2026-10-06): files split into added / modified / renamed / deleted (deleted files and pure renames were previously dropped, and every changed file was labelled "New files"); removed dependencies reported; both compliance passes get the same change description plus a 6,000-char diff excerpt (Pass 1 previously saw no diff text at all) that names every file and cuts long ones fairly. Pass 1's prompt now says removals can violate decisions. *Not done:* removed imports/declarations (needs the pre-change file).
- [x] **M3 Review saw nothing in a nested folder** (2026-10-08, found in manual testing): `test4`/`test5` had no `.git` of their own, so git used the enclosing BluePrint repo, which ignores `test/` since P3 → empty diff → "No uncommitted changes". Underneath: a workspace inside a larger repo was diffed against the *whole* outer repo, with paths relative to its root. Fixed: `git diff --relative`; an empty diff now says why (not a git repo / ignored by the repo at X / really clean). `git init` run in test4 and test5 (nothing committed). Also fixed: adding or deleting an empty file was dropped from the review (git prints no ---/+++ lines for it).
- [x] **M5 Extension missed in test5** (2026-10-08, found in manual testing): `notifications.ts` was never reported because ARCH.md's *planned* Frontend mentions notifications, and Pass 2 couldn't tell planned from built. Fixed by D13. Also: test3's one-line `payment.py` was found only ~3 times in 5 (two prompt rules conflicted), and multi-line or `({ … })` parameter lists were cut off in the change summary. Live checks on Groq `openai/gpt-oss-120b`, 4 runs each: test3 → Payment extension 4/4; test5 → notifications extension and hello.py "checked, not new" 4/4; a React App.tsx in a copy of test5 → planned Frontend now in code 4/4; a new file next to the implemented Frontend → "checked, not new" 4/4. Temperature 0 was tried and did not make results more stable on this model.
- [x] **M4 Duplicate ADRs from wizard follow-ups** (2026-10-08, found in manual testing): the topic answer's draft was shown and saved before its follow-up, whose answer then produced a near-duplicate ADR. Now one ADR per topic (see D5); same number of LLM calls. Checked live on Groq `openai/gpt-oss-120b`: three topic+follow-up runs each gave one combined draft that kept the facts from both answers.
- [x] **M1 Retired default models** (2026-10-06): Google shut down `gemini-2.0-flash` (and `gemini-2.5-*` for new users); OpenRouter's `google/gemini-2.0-flash-exp:free` is gone. Defaults are now the aliases `gemini-flash-latest` and `openrouter/free`; Groq (no alias; `llama-3.3-70b-versatile` retired) uses `openai/gpt-oss-120b`, chosen after a live run of every agent on all Groq chat models. A 404 names the `blueprint.model.<provider>` setting. Anthropic/OpenAI defaults not verified (no keys). The wizard now tells a blocked project ("denied access") apart from a bad key.

## Phase 3b — UI review (2026-10-06, from reading the code; not yet run in VS Code)

**Bugs and stale text** — straightforward fixes.
- [x] **U1** Hub "Before you run" box says new files must be `git add`-ed first. Wrong since untracked files are included in the diff. *(2026-10-08: text now says everything uncommitted is reviewed, .gitignore'd files skipped)*
- [x] **U2** Compliance "No uncommitted changes" screen points to a "Review this change architecturally" button that doesn't exist. *(2026-10-08: explains it compares against the last commit and needs git; "Check again" button)*
- [x] **U3** ADR filter banner says to run "Search ADRs" to change the filter; the command is "Filter ADR Browser". No one-click way to clear an active filter. *(2026-10-08: banner click clears; "Clear ADR Filter" title button shown only while filtering, context key `blueprint.adrFilterActive`)*
- [x] **U4** Compliance "Re-run review" always runs mode `full`. *(2026-10-08: re-run / Try again / Check again keep the mode the panel was opened with)*
- [x] **U5** Clicking "Violation" in the status bar runs a whole new review. *(2026-10-08: internal `blueprint.showLastReview` reveals the open panel; re-runs in the last mode only if it was closed)*
- [x] **U6** The editor-title Hub button shows on every tab in every workspace; Hub cards error before init. *(2026-10-08: button gated on `blueprint.initialized`; before init the Hub shows only an Initialize card and switches live once ARCH.md is generated. The rest of the Hub redesign is U7.)*
- [x] **U17** After every violation in the Compliance panel is resolved, the status bar still said "Violation". *(2026-10-08: back to idle once each violation of the last review is handled; idle rather than OK, since a "Modify Code" fix isn't reviewed yet. First StatusBarManager unit tests, `tests/ui.test.ts`.)*

**Design changes** — recommendation proposed, waiting for the developer's OK.
- [x] **U7** Hub as a state-aware dashboard. *(2026-10-08: before init only "Initialize"; after init the header shows who you are, a banner shows pending approvals (opens the ADR Browser), four cards — Review my changes (full), Pre-check a prompt, View architecture, Add a decision (kept from D11) — and links to Audit trail, Team & roles, Change LLM provider. Redrawn live on every refresh. The single-pass "Check for Violations / Extensions" cards are gone; `ReviewMode` stays in the orchestrator, so U4's mode memory only matters if a single-pass entry point returns.)*
- [x] **U8** Sidebar "Audit Trail" duplicated the ADR list. *(2026-10-08: shows the latest 20 `audit-log.json` entries with an icon per event (warning for a review with violations), "Show all N entries…" and the title button open the full trail, decision entries open their ADR. Refreshes on every append and when the file changes on disk, e.g. after `git pull`.)*
- [x] **U9** No way to change LLM provider / API key without re-running Initialize. *(2026-10-08: "BluePrint: Change LLM Provider / API Key" — quick pick (current marked, model shown) → password box with a key-page button → validated with one request → saved to SecretStorage. Per machine, so no role check or audit entry. In the palette and the ADR Browser "…" menu; the Hub link comes with U7.)*
- [x] **U10** Search vs Filter ADRs overlap. *(Kept both, D12: Search jumps to one ADR, Filter narrows the list; the confusing text was fixed in U3.)*

**Roles in the UI** (agreed 2026-10-06, built)
- [x] **U11 Team & roles setup.** Wizard step 2 of 4 when there is no `roles.json` (Just me / A team / Skip; needs a git email for the first two). If `roles.json` exists the step is skipped and the next screen says which role you have. "Configure Team & Roles" opens the same form as a panel (read-only for Developers; "Edit roles.json directly" stays). The person saving is always an Architect. Initialize is Architect-only once roles exist (D9).
- [x] **U12 Show your role:** status bar tooltip ("You: … · Architect") and the ADR Browser title ("You: Developer").
- [x] **U13 Architect-only controls hidden from Developers:** Approve/Reject (sidebar + palette), Regenerate (palette; disabled in the ARCH.md viewer). Pending ADRs read "needs your approval" or "waiting for an Architect". Approve/Reject check the role before asking for a note.
- [x] **U14 Refresh from disk:** watches `.blueprint/adr-index.json`, `roles.json` and `arch.json`, so a `git pull` (or a hand edit of `roles.json`) updates the sidebar, pending count, role and initialized state without a reload.
- [x] **U15 Honour-system note** in both roles screens (roles.json is protected by code review, e.g. CODEOWNERS, not by BluePrint). *Repeat it in the README (P1).*
- [x] **U16** "Revert ARCH.md" is Architect-only (2026-10-08, D12): enforced in the orchestrator (`revertArch`, checked before the version list), hidden from the palette and disabled in the viewer for Developers.

## Phase 4 — Tests (SRS §5, T1–T53)

- [x] **T-infra** vitest + a file-system-backed `vscode` stand-in (`tests/mocks/vscode.ts`); `npm test`, `npm run typecheck`.
- [x] **T-unit** 104 tests across agents, diff/Tree-sitter, retrieval, ARCH.md patching/history/viewer, ADR storage, roles + approval queue, wizard session, LLM routing/retries/secrets, codebase snapshot. Mutation-checked.
- [x] **T-manual** `docs/TESTING.md`: T1–T53 mapped to automated tests or manual steps, plus an Extension Development Host checklist. *(Checklist not yet run.)*

## Phase 5 — Packaging & docs

- [x] **P1** (2026-10-09) `README.md` (GitHub + Marketplace page; roles honour-system note; screenshot spots marked with HTML comments), `CHANGELOG.md`, icon `media/icon.png` (source `media/icon.svg`, not packaged), `repository`/`bugs`/`homepage`/`galleryBanner`/categories/keywords in package.json. No LICENSE or `license` field (D14), so `--skip-license` stays; `--allow-missing-repository` removed. `npm run package` builds without warnings; the VSIX has readme, changelog and icon, and no `.env`.
- [ ] **P2** Update the SRS test-plan wording where behavior intentionally differs from the code (e.g. T7 says gemini-2.0-flash; T5 etc.), and write the project's own living `ARCH.md`.
- [x] **P3** `test/` fixtures (nested `.git`) are in `.gitignore` (2026-10-08). Confirmed the extension never writes `.gitignore` or `.git/info/exclude` (it only reads ignore rules via `git ls-files --exclude-standard`), so a user's `.blueprint/`, `docs/adr/`, `docs/ARCH.md` stay version-controlled. *Note for P2:* this dev repo's `.gitignore` excludes `docs/ARCH.md`, `docs/adr/` and `.blueprint/`, so BluePrint's own living ARCH.md needs those lines removed (or another location).

## Future extensions

- [ ] **F1 Recognise existing code at initialization.** Initialize builds ARCH.md from the written description only, so in a project that already has code every component starts as **Planned** (D13). A component is marked Implemented only when one of its files changes in a review, or when an Architect runs "Regenerate ARCH.md from codebase". Future: after generating the blueprint, scan the codebase (the snapshot Regenerate already builds) and offer to mark the components it finds as Implemented, with their files.

## Suggested order

Phase 1 → R1 → R2/R3/R4 → R5 → E1/E2/E4 → R6/R7/E3/E5/E6 → tests alongside each phase → Phase 5.
