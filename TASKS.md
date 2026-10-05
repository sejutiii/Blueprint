# BluePrint — Completion Tasks

Gap analysis of the SRS (Aug 2026) against the code as of 2026-10-05. `tsc` and the esbuild build pass; the core agents, hub, setup wizard, pre-check, compliance panel and audit trail work. The items below are what's missing or wrong.

Legend: `[ ]` todo · `[x]` done · **SRS** = section/test-case it satisfies.

## Decisions (agreed with the developer)

- **D1 — Pass 1 and Pass 2 run in parallel** on every full review (deviates from SRS 3.2.3 / 3.3.2, which run Pass 2 only when Pass 1 is clean). Violations and extensions are shown together; extensions found alongside violations carry a warning.
- **D2 — One ADR per item.** Each violation is resolved individually (Update Architecture → its own ADR; Modify Code → no ADR). Extension detection returns a list (max 5); each registered extension → its own ADR + ARCH.md component row.
- **D3 — Keep RBAC** (SRS 3.2.5) and **Tree-sitter** parsing (SRS 3.2.3).
- **D5 — Wizard follow-ups.** The 5 topic questions stay; each answer may yield one LLM-generated follow-up (same LLM call as the analysis, max one level deep, so at most 10 questions).
- **D6 — Regeneration is Architect-only** (a whole-document rewrite doesn't fit the per-ADR approval queue). **Viewer highlights the last 5 recorded changes** (not a time window).
- **D7 — Bring your own key in public builds.** The built-in default key exists only in local dev builds (from `.env`).
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
- [ ] **B11** `.vscodeignore` excludes `node_modules/**`, but `@huggingface/transformers` / `onnxruntime-node` / `sharp` are esbuild externals → in a packaged VSIX local embeddings **always** fail and silently fall back to TF-IDF. Ship the runtime deps (or pre-bundle the model) and verify with `vsce ls`. *SRS 4.2*
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
- [ ] **E6 Settings**: `contributes.configuration` for provider/model override, top-K, auto-review on new file, light/heavy tier model (the `tier` placeholder in future_extensions #1).

## Phase 4 — Tests (SRS §5, T1–T53)

- [ ] **T-infra** Add vitest + a `vscode` module stub; `npm test` script.
- [ ] **T-unit** Automated tests for the pure logic: DiffSummarizer (T21–T25), RetrievalAgent (T26–T31), agent parsing/safe defaults (T14, T17, T18, T35), `adrFilename`/ID padding (T41–T42), LLMClient routing with mocked `fetch` (T7–T10), RBAC resolution, ARCH.md patching, history.
- [ ] **T-manual** Checklist for the VS Code–dependent cases (T1–T4, T36, T39–T40, T44, T47–T53), run in the Extension Development Host against `test/`.

## Phase 5 — Packaging & docs

- [ ] **P1** `README.md`, `LICENSE`, `CHANGELOG.md`, extension icon, `repository`/`license`/`galleryBanner` in package.json; `vsce package` produces a working VSIX (verify the contents).
- [ ] **P2** Update the SRS test-plan wording where behavior intentionally differs from the code (e.g. T7 says gemini-2.0-flash; T5 etc.), and write the project's own living `ARCH.md`.
- [ ] **P3** `.gitignore` currently excludes `.blueprint/`, `docs/adr/`, `docs/ARCH.md`, which the SRS says should be version-controlled in a *user's* repo — fine for this dev repo, but confirm the extension never writes a `.gitignore` entry for them. Add `test/` fixtures (they contain nested `.git`) to `.gitignore`.

## Suggested order

Phase 1 → R1 → R2/R3/R4 → R5 → E1/E2/E4 → R6/R7/E3/E5/E6 → tests alongside each phase → Phase 5.
