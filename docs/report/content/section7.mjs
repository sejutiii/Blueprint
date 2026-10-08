// Section 7: Testing. `B` holds the document building blocks (see build-report.mjs).
export function section7(B) {
  return [
    B.h1("7 Testing"),
    B.p("This section describes how BluePrint was tested: the strategy, the criteria for passing or failing a test item, the main risks and how they are handled, and the main test cases with their outcomes. Test case identifiers in the form T*n* refer to the test plan of the Software Requirements Specification (SRS)."),

    // ── 7.1 ───────────────────────────────────────────────────────────────────
    B.h2("7.1 Testing Approach and Strategy"),
    B.p("Testing combines four levels, from fast and deterministic to slow and realistic:"),
    B.bullet("**Unit and integration tests** run with Vitest on every change: 169 tests in 8 files covering the LLM client (routing for five providers, retries, key validation), the agents, diff summarization, retrieval, ADR storage, ARCH.md patching and history, roles and the approval queue, and the UI state classes. The VS Code API is replaced by a stand-in backed by real temporary folders, so file reading and writing are exercised for real; the language model is replaced by a scripted fake that returns prepared answers and records each prompt."),
    B.bullet("**Integration with real tools.** Diff tests create temporary git repositories (commits, renames, deletions, untracked files, nested and ignored folders) and parse the changes with the real Tree-sitter grammars."),
    B.bullet("**Live model tests.** Behaviour that depends on the model's judgment (the wizard's follow-ups, extension detection) is checked against a real provider (Groq, model `openai/gpt-oss-120b`) on the sample projects, several runs per case, because model output varies between runs."),
    B.bullet("**Manual acceptance tests** in the VS Code Extension Development Host follow a checklist that maps every SRS test case (T1 to T53) to an automated test or a manual step."),
    B.p("Static checks (TypeScript type checking and ESLint) run alongside the tests. When a defect is fixed, a regression test is added, and for important fixes the test is confirmed to fail when the fix is removed (a manual mutation check), so the test is known to catch the defect."),

    // ── 7.2 ───────────────────────────────────────────────────────────────────
    B.h2("7.2 Item Pass/Fail Criteria"),
    B.bullet("**Build:** a change is accepted only when every automated test passes, the type check reports no errors and the linter reports no problems."),
    B.bullet("**Automated test case:** passes when all its assertions hold; any failed assertion or unexpected exception fails it."),
    B.bullet("**Model-dependent behaviour:** passes when the answer is parsed into a valid result and the expected outcome is produced in every one of four live runs; one wrong run fails it and the prompt is revised."),
    B.bullet("**Manual test case:** passes when the observed behaviour matches the expected result in the checklist; a crash, an unhandled error, lost data or a blocked interface fails it."),
    B.bullet("**Robustness:** malformed model output, network failures and missing files must never crash the extension or corrupt stored data; the user must see a clear message instead."),

    // ── 7.3 ───────────────────────────────────────────────────────────────────
    B.h2("7.3 Risks and Contingencies"),
    ...B.table("Table 7.1: Testing risks and contingencies", ["Risk", "Impact", "Contingency"], [
      ["Model answers vary between runs", "Inconsistent violations or component verdicts", "Strict JSON format, answers checked against the real components, safe defaults; every verdict can be overruled in the panel; repeated live runs before a prompt change is accepted"],
      ["Provider rate limits or outages", "Checks fail or slow down", "Time-out and retry with back-off; clear error with Try again; provider can be changed without re-initializing"],
      ["Provider retires a model", "Requests fail (HTTP 404)", "Maintained default models, a per-provider model setting, and an error message that names the setting"],
      ["Embedding model unavailable (offline, unsupported platform)", "Less accurate ADR retrieval", "Automatic fallback to lexical (TF-IDF) ranking, covered by tests"],
      ["Platform-specific packages not run on Linux or macOS", "Installation problems on those systems", "A universal package without native code; marked as untested"],
      ["Project not a git repository, or inside a larger one", "Reviews find nothing to check", "The panel states the reason and the fix; a non-git fallback is planned"],
      ["Concurrent writes to the ADR index", "Duplicate or skipped ADR numbers", "Writes are serialized; covered by a concurrency test"],
      ["Manual acceptance testing not yet complete", "Interface defects may remain", "Checklist in progress; each defect found so far was fixed with a regression test"],
    ], [2.4, 2.2, 4.8]),

    // ── 7.4 ───────────────────────────────────────────────────────────────────
    B.h2("7.4 Test Cases"),
    B.p("Table 7.2 lists the main functional and API test cases. \"Auto\" cases run in the automated suite; \"Live\" cases were run against the real model; \"Manual\" cases are part of the acceptance checklist."),
    ...B.table("Table 7.2: Test cases with outcomes", ["ID", "Feature (SRS)", "Input / procedure", "Expected outcome", "Actual outcome", "Result"], [
      ["TC-01", "LLM request routing (T7–T9)", "Send a prompt through each provider: Gemini, Anthropic, OpenAI, Groq, OpenRouter (Auto)", "Correct endpoint, model and message format; API key sent in a header, never in the URL", "Requests built as expected for all five providers", "Pass"],
      ["TC-02", "LLM errors and retries (T10)", "Provider returns 429 (with retry-after), a non-retryable error, a 404, and an empty response (Auto)", "429 retried with back-off, giving up after three attempts; other errors reported with their status; a 404 names the model setting; an empty response is an error, not a crash", "As expected", "Pass"],
      ["TC-03", "API key storage and validation (T5, T6)", "Save a key; validate a working key, a rejected key, an unknown model and a blocked project (Auto, Live)", "Key and provider stored only in secret storage; each failure mapped to an actionable message; a working key accepted", "As expected; a real Groq key validated live", "Pass"],
      ["TC-04", "Architecture generation (T11, T13, T14)", "Model returns valid JSON, fenced JSON, and plain text (Auto)", "Blueprint written to arch.json and ARCH.md with every component Planned; fences stripped; plain text reported with the raw response", "As expected", "Pass"],
      ["TC-05", "Constraint questions (T16–T18)", "Concrete, tentative and empty answers (Auto)", "Draft ADR for a concrete answer; none for a tentative one; no model call for an empty one", "As expected", "Pass"],
      ["TC-06", "One ADR per topic (follow-ups)", "Topic answer with a follow-up, then answer, skip, or answer \"not sure\" (Auto, Live)", "Draft held until the follow-up; one ADR covering both answers; the first answer's draft offered on skip", "As expected; 3 of 3 live topics gave one combined draft keeping facts from both answers", "Pass"],
      ["TC-07", "Diff summarization (T21–T25)", "Git repository with modified, new, renamed, deleted, empty and untracked files; nested and ignored folders (Auto)", "Files classified correctly; new imports, declarations and dependency changes extracted; only the workspace's own changes; the reason given when nothing is found", "As expected", "Pass"],
      ["TC-08", "ADR retrieval (T26–T31)", "Several accepted ADRs and a query; embedding model unavailable (Auto)", "Top 5 ranked by blended score with component-name boost; embeddings cached; lexical fallback", "As expected", "Pass"],
      ["TC-09", "Violation detection (T32, T35)", "Model reports a violation; model returns malformed output (Auto)", "Violation shown with severity and location; malformed output treated as no violation, without crashing", "As expected", "Pass"],
      ["TC-10", "Planned vs. new components (T37)", "Sample projects: a payment module in a PDF tool; a notifications module; a React app for a planned Frontend; a file next to the implemented Frontend (Live, 4 runs each)", "New component; new component; planned component now in code; checked, not new", "4 of 4 runs correct for each case", "Pass"],
      ["TC-11", "Resolving review items (T36, T39)", "Update Architecture on two violations; register an extension (Auto)", "One ADR per item; the extension's ARCH.md row is added as Implemented with its files on acceptance", "As expected", "Pass"],
      ["TC-12", "Mark a planned component implemented", "Mark the planned Frontend implemented as a Developer (Auto)", "ARCH.md and arch.json updated, no ADR created, history snapshot and audit entry written", "As expected", "Pass"],
      ["TC-13", "Roles and approval queue (SRS 3.2.5)", "Developer saves a decision; Architect approves or rejects; Developer tries to approve, revert or initialize (Auto)", "Developer's ADR pending and ARCH.md unchanged until approval; rejection needs a reason; Architect-only actions refused for Developers", "As expected", "Pass"],
      ["TC-14", "ADR storage (T41–T43)", "Create ADRs concurrently; change an ADR's title (Auto)", "Sequential zero-padded IDs with no duplicates; file renamed with the title; index and Markdown updated", "As expected", "Pass"],
      ["TC-15", "ARCH.md patching and history", "Apply ADR effects to a hand-edited ARCH.md; revert; older table without a Status column (Auto)", "Manual edits preserved; snapshot before every change; revert restores; Status column added", "As expected", "Pass"],
      ["TC-16", "Prompt pre-check (T45, T46)", "Prompt that conflicts with an ADR; prompt without conflicts; copy with context (Auto)", "Concerns with a suggested revision; clean result; copied text contains the prompt, the selected ADRs and the constraints", "As expected", "Pass"],
      ["TC-17", "Replacing a decision (Add Decision)", "Architect saves a decision that replaces an accepted ADR; Developer does the same (Auto)", "Old ADR superseded and its ARCH.md constraint swapped; for a Developer, nothing changes until approval", "As expected", "Pass"],
      ["TC-18", "Status bar behaviour (T4)", "Violation found, clicked, then every violation handled (Auto)", "Click reopens the review; the state returns to Idle when every violation is handled", "As expected", "Pass"],
      ["TC-19", "Extension in VS Code (T1–T3, T44, T47–T53)", "Manual checklist in the Extension Development Host on the sample projects", "Activation, sidebar, panels, singleton panels and the audit-trail handshake behave as specified", "Partly run: three defects found and fixed with regression tests; checklist in progress", "In progress"],
    ], [0.85, 1.45, 2.15, 2.3, 1.85, 0.9]),
    B.p("All 169 automated tests pass, and the type check and linter report no problems. Every live case met its criterion of four correct runs out of four. The manual acceptance checklist was partly run: it found three defects (reviews of nested folders saw no changes, the wizard created near-duplicate ADRs from follow-up questions, and a new component was missed because planned and implemented components were not told apart), each of which was fixed and covered by new tests."),
  ];
}
