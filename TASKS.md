# BluePrint — Completion Tasks

## ▶ Resume here (paused 2026-10-05)

**State.** All work is committed on branch `complete-srs` (`main` is untouched); the only untracked files are the `test/` fixture projects. `npm test` (104 tests) and `npm run typecheck` pass; `npm run build` and `npm run package` work. Phases 1–4 are done except the items below.

**Next steps, in order**
1. **UI fixes** — see "Phase 3b — UI review" below. U1–U6 are plain fixes; U7–U10 have a recommendation that still needs the developer's OK; U16 is an open question. U11–U15 (roles) are done. Done first so the manual checklist tests the updated UI.
2. **Run the manual checklist** in [docs/TESTING.md](docs/TESTING.md) in the Extension Development Host (F5) against the projects in `test/`. *Nothing has been run inside VS Code yet* — expect a few more UI fixes. Fix whatever it finds.
3. **Small items:** B15 (ESLint config), P3 (gitignore `test/`), E6 (settings — present a plan first).
4. **E5** non-git diff fallback — present a plan first.
5. **P1** README / LICENSE / `repository` / icon — **open question: which license?** (MIT suggested). Then drop the `--allow-missing-repository --skip-license` flags in `scripts/package.js` (marked TODO).
6. **P2** update the SRS where behaviour deliberately changed (D1–D8 below; T34 and T49 in particular) and write the project's own ARCH.md.

**Known unverified / caveats**
- Linux and macOS VSIXs build but were never run; only Windows x64 embeddings were verified (from the unpacked VSIX).
- "Regenerate ARCH.md from codebase" has not been tried against a real LLM.
- Rotate the dev API key in `.env` if any build or VSIX from before 2026-10-05 was shared.
- The current dev Gemini key (2026-10-06) is valid but its Google Cloud project gets 403 "Your project has been denied access" on every model, so no live LLM run has been done with `gemini-flash-latest` yet. Needs a key from another project (or a Groq key) before the manual checklist.
- Minor: a one-line Python `def f(): pass` keeps `pass` in its signature; an ADR slug cut at 50 chars can end in `-`. Both harmless; changing the slug would orphan existing ADR files.

**Working agreement.** Before each feature: explain the current behaviour and the planned changes, wait for approval, then build → test → commit on `complete-srs`, and record decisions in the Decisions list below.

---

Gap analysis of the SRS (Aug 2026) against the code as of 2026-10-05. `tsc` and the esbuild build pass; the core agents, hub, setup wizard, pre-check, compliance panel and audit trail work. The items below are what's missing or wrong.

Legend: `[ ]` todo · `[x]` done · **SRS** = section/test-case it satisfies.

## Decisions (agreed with the developer)

- **D1 — Pass 1 and Pass 2 run in parallel** on every full review (deviates from SRS 3.2.3 / 3.3.2, which run Pass 2 only when Pass 1 is clean). Violations and extensions are shown together; extensions found alongside violations carry a warning.
- **D2 — One ADR per item.** Each violation is resolved individually (Update Architecture → its own ADR; Modify Code → no ADR). Extension detection returns a list (max 5); each registered extension → its own ADR + ARCH.md component row.
- **D3 — Keep RBAC** (SRS 3.2.5) and **Tree-sitter** parsing (SRS 3.2.3).
- **D5 — Wizard follow-ups.** The 5 topic questions stay; each answer may yield one LLM-generated follow-up (same LLM call as the analysis, max one level deep, so at most 10 questions).
- **D6 — Regeneration is Architect-only** (a whole-document rewrite doesn't fit the per-ADR approval queue). **Viewer highlights the last 5 recorded changes** (not a time window).
- **D7 — Bring your own key in public builds.** The built-in default key exists only in local dev builds (from `.env`).
- **D8 — Packaging:** one VSIX per platform + universal fallback; embedding model downloaded on first use (not bundled).
- **D9 — Roles are set up during initialization** (new wizard step when there is no `roles.json`; an existing one is used as is). Once Architects are named, only they can initialize/re-initialize or change roles.
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
- [ ] **B15** No ESLint config exists, so `npm run lint` fails.
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
- [ ] **E5 Non-git diff fallback** *(future_extensions #4)*: file-manifest snapshot on init; diff against it when the workspace isn't a git repo.
- [ ] **E6 Settings**: `contributes.configuration` for provider/model override, top-K, auto-review on new file, light/heavy tier model (the `tier` placeholder in future_extensions #1). *Done so far:* auto-review on new file; per-provider model override `blueprint.model.<provider>` (2026-10-06). *Left:* top-K, light/heavy tier.
- [x] **M1 Retired default models** (2026-10-06): Google shut down `gemini-2.0-flash` (and `gemini-2.5-*` for new users); OpenRouter's `google/gemini-2.0-flash-exp:free` is gone. Defaults are now the aliases `gemini-flash-latest` and `openrouter/free`; a 404 names the `blueprint.model.<provider>` setting. Groq/Anthropic/OpenAI defaults not verified (no keys). The wizard now tells a blocked project ("denied access") apart from a bad key.

## Phase 3b — UI review (2026-10-06, from reading the code; not yet run in VS Code)

**Bugs and stale text** — straightforward fixes.
- [ ] **U1** Hub "Before you run" box says new files must be `git add`-ed first. Wrong since untracked files are included in the diff. *`media/blueprintHub.html`*
- [ ] **U2** Compliance "No uncommitted changes" screen points to a "Review this change architecturally" button that doesn't exist. *`media/compliancePanel.html`*
- [ ] **U3** ADR filter banner says to run "Search ADRs" to change the filter; the command is "Filter ADR Browser". No one-click way to clear an active filter (add a "Clear filter" view-title button shown only while filtering). *`src/ui/AdrTreeProvider.ts`*
- [ ] **U4** Compliance "Re-run review" always runs mode `full`, even when the panel was opened as violations-only or extensions-only. Re-run should keep the original mode. *`src/extension.ts` `setCompliancePanelHandler`*
- [ ] **U5** Clicking "Violation" in the status bar runs a whole new review (LLM calls). It should reveal the open Compliance panel, and only re-run if that panel was closed. *`src/ui/StatusBarManager.ts`*
- [ ] **U6** The editor-title Hub button shows on every tab in every workspace, even ones not using BluePrint; Hub cards error before init. Gate the button on `blueprint.initialized` and make the Hub init-aware (see U7). *`package.json` menus*

**Design changes** — recommendation proposed, waiting for the developer's OK.
- [ ] **U7 Hub as a state-aware dashboard.** With D1 the separate Violations / Extensions cards are mostly redundant, and newer features (viewer, audit trail, approvals, roles) aren't reachable from the Hub. *Recommended:* main cards **Review my changes** (full), **Pre-check a prompt**, **View architecture**; secondary links Audit trail, **N pending approvals**, Configure roles, Change LLM provider; before init, a single **Initialize** card. *Alternative:* drop the Hub and put actions in the sidebar.
- [ ] **U8 Sidebar "Audit Trail" duplicates the ADR list** (same ADRs, sorted by date; no reviews / pre-checks / ARCH.md changes). *Recommended:* show the last ~20 entries from `audit-log.json` there, with a title button to open the full trail. *Alternative:* remove the view.
- [ ] **U9 No way to change LLM provider / API key** without re-running Initialize (which warns about regenerating ARCH.md). *Recommended:* new command "BluePrint: Change LLM Provider / API Key" — quick pick provider → password input → validate → save; linked from the Hub. Overlaps E6.
- [ ] **U10 Search vs Filter ADRs overlap.** *Recommended:* keep both (Search jumps to one ADR, Filter narrows the list); covered by the U3 fixes.

**Roles in the UI** (agreed 2026-10-06, built)
- [x] **U11 Team & roles setup.** Wizard step 2 of 4 when there is no `roles.json` (Just me / A team / Skip; needs a git email for the first two). If `roles.json` exists the step is skipped and the next screen says which role you have. "Configure Team & Roles" opens the same form as a panel (read-only for Developers; "Edit roles.json directly" stays). The person saving is always an Architect. Initialize is Architect-only once roles exist (D9).
- [x] **U12 Show your role:** status bar tooltip ("You: … · Architect") and the ADR Browser title ("You: Developer").
- [x] **U13 Architect-only controls hidden from Developers:** Approve/Reject (sidebar + palette), Regenerate (palette; disabled in the ARCH.md viewer). Pending ADRs read "needs your approval" or "waiting for an Architect". Approve/Reject check the role before asking for a note.
- [x] **U14 Refresh from disk:** watches `.blueprint/adr-index.json`, `roles.json` and `arch.json`, so a `git pull` (or a hand edit of `roles.json`) updates the sidebar, pending count, role and initialized state without a reload.
- [x] **U15 Honour-system note** in both roles screens (roles.json is protected by code review, e.g. CODEOWNERS, not by BluePrint). *Repeat it in the README (P1).*
- [ ] **U16 Open question:** "Revert ARCH.md" is still allowed for Developers, although it rewrites the whole document like Regenerate. Make it Architect-only too?

## Phase 4 — Tests (SRS §5, T1–T53)

- [x] **T-infra** vitest + a file-system-backed `vscode` stand-in (`tests/mocks/vscode.ts`); `npm test`, `npm run typecheck`.
- [x] **T-unit** 104 tests across agents, diff/Tree-sitter, retrieval, ARCH.md patching/history/viewer, ADR storage, roles + approval queue, wizard session, LLM routing/retries/secrets, codebase snapshot. Mutation-checked.
- [x] **T-manual** `docs/TESTING.md`: T1–T53 mapped to automated tests or manual steps, plus an Extension Development Host checklist. *(Checklist not yet run.)*

## Phase 5 — Packaging & docs

- [ ] **P1** `README.md`, `LICENSE`, `CHANGELOG.md`, extension icon, `repository`/`license`/`galleryBanner` in package.json; `vsce package` produces a working VSIX (verify the contents).
- [ ] **P2** Update the SRS test-plan wording where behavior intentionally differs from the code (e.g. T7 says gemini-2.0-flash; T5 etc.), and write the project's own living `ARCH.md`.
- [ ] **P3** `.gitignore` currently excludes `.blueprint/`, `docs/adr/`, `docs/ARCH.md`, which the SRS says should be version-controlled in a *user's* repo — fine for this dev repo, but confirm the extension never writes a `.gitignore` entry for them. Add `test/` fixtures (they contain nested `.git`) to `.gitignore`.

## Suggested order

Phase 1 → R1 → R2/R3/R4 → R5 → E1/E2/E4 → R6/R7/E3/E5/E6 → tests alongside each phase → Phase 5.
