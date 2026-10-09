// Section 5: Component-level design. `B` holds the document building blocks (see build-report.mjs).
export function section5(B) {
  return [
    B.h1("5 Component-Level Design"),
    B.p("This section refines the architecture of BluePrint into its components. BluePrint is a Visual Studio Code extension written in TypeScript; it keeps a project's architecture (`ARCH.md`) and its Architectural Decision Records (ADRs) next to the code and uses a large language model (LLM) to check prompts and code changes against them. Section 5.1 gives a simplified overview, 5.2 identifies the classes that model the problem domain, 5.3 describes every design class with its responsibilities and collaborators, 5.4 lists the persistent data sources, and 5.5 elaborates the behaviour of the main classes."),

    // ── 5.1 ───────────────────────────────────────────────────────────────────
    B.h2("5.1 Architecture Overview"),
    B.p("BluePrint is organised in four layers (Figure 5.1). The **UI layer** registers the extension's commands, sidebar views, status bar item and webview panels. The **coordination layer** turns user actions and workspace events into pipelines: the `Orchestrator` routes each event to the agents it needs, and the `DecisionService` is the single entry point through which every new decision is recorded. The **agent layer** holds the LLM-backed agents and the analysis steps that prepare their input. The **infrastructure layer** wraps everything outside the extension: the LLM providers, local embeddings, source parsing, the project files and the VS Code storage."),
    B.p("Calls only go downwards. The coordination layer reports back to the UI through two hooks, a state change (idle, checking, OK, violation) and a data change, so the UI never depends on how a pipeline works."),
    ...B.figure("5-1-layers.png", "Figure 5.1: Layered architecture of BluePrint (simplified)"),

    // ── 5.2 ───────────────────────────────────────────────────────────────────
    B.h2("5.2 Design Classes of the Problem Domain"),
    B.p("The problem domain is architectural knowledge and how code changes are checked against it. Table 5.1 lists the classes that model it; Figures 5.2 and 5.3 show their attributes and relationships. These are data classes: they carry no behaviour and are shared by all layers."),
    ...B.table("Table 5.1: Problem-domain classes", ["Class", "Represents", "Key attributes"], [
      ["ArchBlueprint", "The project's architecture, rendered as `ARCH.md`", "system overview, components, data flow, constraints, open questions"],
      ["ArchComponent", "One component of the architecture", "name, responsibility, technology, **status** (planned or implemented), files that implement it"],
      ["ADR", "An Architectural Decision Record", "title, context, decision, consequences, **status**, proposer and reviewer, the effect it has on ARCH.md, the ADR it supersedes"],
      ["ArchEffect", "What accepting an ADR changes in ARCH.md", "add a component, add a constraint, replace a constraint, mark a component implemented"],
      ["RolesManifest", "The team's roles", "Architect and Developer e-mail addresses"],
      ["AuditEntry", "One event in the decision audit trail", "time, event type, summary, actor, changed files, linked ADR or review result"],
      ["ArchHistoryEntry", "An earlier version of ARCH.md", "time, reason for the change, sections it touched"],
      ["DiffSummary", "The uncommitted code change under review", "added, modified, renamed and deleted files; new imports and declarations; added and removed dependencies; a diff excerpt"],
      ["ComplianceResult", "The outcome of one review", "violations (Pass 1); extensions, planned components now in code and checked files (Pass 2); ADRs used as context"],
      ["ViolationDetail", "A change that breaks a constraint or ADR", "constraint or ADR id, description, severity, code location"],
      ["ExtensionDetail", "New code that is neither a planned nor an implemented component", "name, responsibility, technology, rationale, files"],
      ["PlannedComponentMatch", "New code that is a planned component", "component name, files, rationale"],
      ["CheckedFile", "An added file that is neither, with the reason", "file, reason"],
    ], [2.0, 3.1, 4.4]),
    ...B.figure("5-2-domain-knowledge.png", "Figure 5.2: Domain classes for architectural knowledge"),
    B.p("An ADR changes the architecture only when it is accepted: its `ArchEffect` is applied to `ArchBlueprint` at that moment, so a Developer's proposal leaves ARCH.md untouched until an Architect approves it. Each change to ARCH.md is preceded by an `ArchHistoryEntry`, which makes every change revertible. A component is **planned** when it was described (for example during initialization) but has no code yet, and **implemented** once code for it exists."),
    ...B.figure("5-3-domain-review.png", "Figure 5.3: Domain classes for a compliance review"),
    B.p("A review produces one `ComplianceResult` from one `DiffSummary`. Pass 1 contributes the violations; Pass 2 sorts the new code into the three remaining groups. A violation refers to an existing ADR or constraint; an extension becomes a new component once its ADR is accepted; a planned match marks an existing component implemented without an ADR, because that component was already decided."),

    // ── 5.3 ───────────────────────────────────────────────────────────────────
    B.h2("5.3 Design Classes: Responsibilities and Collaborators"),
    B.p("Tables 5.2 to 5.5 give the Class-Responsibility-Collaborator (CRC) description of every design class, layer by layer. Collaborators are the classes a class calls directly; «module» marks a file of functions rather than a class. The HTML pages of the webview panels are covered in Section 6."),
    ...B.table("Table 5.2: CRC cards, UI layer", ["Class", "Responsibilities", "Collaborators"], [
      ["Extension\n«module»".split("\n"), [
        "• Register commands, sidebar views and the status bar item",
        "• Open webview panels and relay their messages to the Orchestrator",
        "• Run the setup wizard and the LLM provider / API key change, validating each key",
        "• Offer a review when new files are created",
        "• Watch ARCH.md, the ADR index, roles.json and the audit log, and refresh the UI",
      ], "Orchestrator, BlueprintPanel, StatusBarManager, AdrTreeProvider, AuditTrailTreeProvider, LLMClient, AccessControl, AdrStore, FileStore, AuditLog"],
      ["BlueprintPanel", [
        "• Keep one webview panel per type (Hub, Setup, Compliance Review, Pre-Check, Add Decision, ARCH.md Viewer, Audit Trail, Team & Roles)",
        "• Load each panel's HTML with a content-security nonce",
        "• Pass messages between the panel and the extension",
      ], "Extension"],
      ["StatusBarManager", [
        "• Show the state: not initialized, idle with the pending-approval count, checking, OK, violation",
        "• Bind each state's click to the right action (a violation reopens the last review)",
        "• Show the user's identity and role in the tooltip",
      ], "Extension"],
      ["AdrTreeProvider", [
        "• List ADRs in the sidebar grouped by status, pending approvals first",
        "• Filter ADRs by text; clear the filter",
        "• Offer Approve / Reject to Architects; mark superseded ADRs",
      ], "Extension"],
      ["AuditTrailTreeProvider", [
        "• List the 20 most recent audit-log entries, newest first",
        "• Open the linked ADR, or the full audit trail, when an entry is clicked",
      ], "Extension"],
    ], [2.0, 5.2, 2.6]),
    ...B.table("Table 5.3: CRC cards, coordination layer", ["Class", "Responsibilities", "Collaborators"], [
      ["Orchestrator", [
        "• Route events (project initialized, prompt submitted, code generated, review requested) to agent pipelines",
        "• Run compliance Pass 1 and Pass 2 in parallel",
        "• Resolve violations, register extensions, mark planned components implemented",
        "• Draft and save decisions; generate, regenerate and revert ARCH.md",
        "• Enforce Architect-only actions; read and save roles",
        "• Report workflow state and data changes to the UI",
      ], "ArchitectureAgent, ConstraintElicitationAgent, ComplianceAgent, PreCheckAgent, RetrievalAgent, DiffSummarizer, DecisionService, CodebaseSnapshot, LLMClient, FileStore, AdrStore, AuditLog, AccessControl"],
      ["DecisionService", [
        "• Single entry point for every new ADR",
        "• Accept an Architect's decision immediately; queue a Developer's for approval",
        "• Approve or reject pending ADRs (a rejection needs a reason)",
        "• On acceptance: patch ARCH.md, supersede the ADR it replaces, cache its embedding, write the audit trail",
      ], "AdrStore, FileStore, AuditLog, AccessControl, RetrievalAgent"],
    ], [2.0, 5.2, 2.6]),
    ...B.table("Table 5.4: CRC cards, agent layer", ["Class", "Responsibilities", "Collaborators"], [
      ["ArchitectureAgent", [
        "• Generate the blueprint from a system description (every component planned)",
        "• Regenerate it from a codebase snapshot, keeping every constraint and taking component status from the code",
        "• Validate the model's JSON",
      ], "LLMClient"],
      ["ConstraintElicitationAgent", [
        "• Turn a wizard answer into an ADR draft and at most one follow-up question",
        "• Draft an ADR from a free-text decision; suggest the ADR it supersedes; flag tentative input",
      ], "LLMClient, ElicitationSession"],
      ["ElicitationSession", [
        "• Walk the five topic questions and their follow-ups",
        "• Hold a topic's draft until its follow-up is answered, so each topic yields at most one ADR",
      ], "none"],
      ["ComplianceAgent", [
        "• Pass 1: find violations of constraints and relevant ADRs",
        "• Pass 2: sort new code into planned components now in code, extensions (at most five) and checked files with reasons",
        "• Check the model's answer against the real components; fall back to safe defaults on unparseable output",
      ], "LLMClient"],
      ["PreCheckAgent", [
        "• Check a coding prompt against constraints and ADRs before any code exists",
        "• Suggest a revised prompt when it conflicts",
      ], "LLMClient"],
      ["RetrievalAgent", [
        "• Rank accepted ADRs by relevance: TF-IDF blended with local embeddings, plus a component-name boost",
        "• Build a search query from a diff summary; cache ADR embeddings",
      ], "EmbeddingService, AdrStore"],
      ["DiffSummarizer", [
        "• Collect the uncommitted changes of the workspace folder (git diff and untracked files); say why a diff is empty",
        "• Skip lock files and BluePrint's own files; classify files as added, modified, renamed or deleted",
        "• Extract new imports, declarations and added or removed dependencies; build a diff excerpt",
      ], "TreeSitterExtractor"],
    ], [2.0, 5.2, 2.6]),
    ...B.table("Table 5.5: CRC cards, infrastructure layer", ["Class", "Responsibilities", "Collaborators"], [
      ["LLMClient", [
        "• Send prompts to Gemini, Groq, OpenRouter, Anthropic or OpenAI",
        "• Time out, and retry on rate limits and server errors",
        "• Validate an API key with one request; keep it in VS Code secret storage",
        "• Choose the model (setting, or a maintained default)",
      ], "external LLM APIs"],
      ["EmbeddingService", [
        "• Compute sentence embeddings locally (all-MiniLM-L6-v2, 8-bit)",
        "• Download the model on first use; report failure so retrieval falls back to TF-IDF",
      ], "none"],
      ["TreeSitterExtractor\n«module»".split("\n"), [
        "• Parse source files with Tree-sitter (eight languages)",
        "• Extract added imports and declaration headers; top-level mode for project overviews",
      ], "none"],
      ["CodebaseSnapshot\n«module»".split("\n"), [
        "• Build a compact project overview (dependency manifests, README, top-level declarations, file tree) for regenerating ARCH.md",
      ], "TreeSitterExtractor"],
      ["AdrStore", [
        "• Persist ADRs as an index plus one Markdown file each",
        "• Assign sequential IDs with serialized writes; update ADRs, renaming the file when the title changes",
      ], "none"],
      ["FileStore", [
        "• Read and write ARCH.md and arch.json",
        "• Apply targeted patches that keep manual edits (add component, add or replace constraint, mark implemented)",
        "• Snapshot ARCH.md before every change; revert to a snapshot",
      ], "none"],
      ["AuditLog", [
        "• Append audit events: reviews, pre-checks, decisions, ARCH.md and role changes",
        "• Notify listeners on every append",
      ], "none"],
      ["AccessControl", [
        "• Identify the user from git user.email",
        "• Read and write roles.json; resolve Architect or Developer",
      ], "none"],
    ], [2.0, 5.2, 2.6]),

    // ── 5.4 ───────────────────────────────────────────────────────────────────
    B.h2("5.4 Persistent Data Sources"),
    B.p("BluePrint uses no database. Everything a team shares is stored as JSON and Markdown files inside the project, so architectural decisions travel with the code through git and can be reviewed in pull requests like any other change. Per-user data (the API key, settings and the embedding model) stays in VS Code's own storage and never enters the repository. Table 5.6 lists every persistent data source and the class that owns it."),
    ...B.table("Table 5.6: Persistent data sources", ["Data source", "Location and format", "Contents", "Owning class", "In git"], [
      ["Architecture blueprint", "`.blueprint/arch.json` (JSON)", "Overview, components with status and files, data flow, constraints, open questions", "FileStore", "Yes"],
      ["Architecture document", "`docs/ARCH.md` (Markdown)", "Readable blueprint; manual edits are preserved by targeted patches", "FileStore", "Yes"],
      ["ARCH.md history", "`.blueprint/history/` (index plus one snapshot per change)", "Previous versions with the reason and the sections changed", "FileStore", "Yes"],
      ["ADR index", "`.blueprint/adr-index.json` (JSON)", "Every ADR: status, proposer, reviewer, effect, supersedes, cached embedding", "AdrStore", "Yes"],
      ["ADR documents", "`docs/adr/NNNN-title.md` (Markdown)", "One readable record per ADR", "AdrStore", "Yes"],
      ["Audit log", "`.blueprint/audit-log.json` (JSON, append-only)", "Timestamped events with actor, files and results", "AuditLog", "Yes"],
      ["Roles manifest", "`.blueprint/roles.json` (JSON)", "Architect and Developer e-mail addresses", "AccessControl", "Yes"],
      ["Provider and API key", "VS Code secret storage (operating-system keychain)", "Chosen LLM provider and its key", "LLMClient", "No"],
      ["Settings", "VS Code settings", "Model per provider; automatic review of new files", "LLMClient, Extension", "No"],
      ["Embedding model", "VS Code global storage", "all-MiniLM-L6-v2 (8-bit, about 23 MB), downloaded once", "EmbeddingService", "No"],
      ["Code changes (read only)", "The project's git repository", "Uncommitted and untracked changes under review", "DiffSummarizer", "n/a"],
    ], [1.7, 2.3, 2.9, 1.4, 0.7]),

    // ── 5.5 ───────────────────────────────────────────────────────────────────
    B.h2("5.5 Behavioural Representations"),
    B.p("This section elaborates the behaviour of the components with state diagrams for the classes whose objects have a lifecycle, a sequence diagram for the main use case, and an event-driven collaboration diagram for the whole extension."),
    B.h3("5.5.1 State Diagrams"),
    B.p("Figure 5.4 (a) shows the lifecycle of an ADR. Every decision, whichever way it is made, is first recorded as **proposed**. It is accepted at once when the proposer is an Architect; otherwise it waits in the approval queue until an Architect approves or rejects it. Only accepted ADRs change ARCH.md and are used as context in later checks. An accepted ADR becomes **superseded** when a newer ADR that replaces it is accepted. Figure 5.4 (b) shows the status of an architecture component: planned components become implemented when their code appears, without a new ADR."),
    ...B.figure("5-4-lifecycles.png", "Figure 5.4: State diagrams of (a) an ADR and (b) an architecture component"),
    B.p("Figure 5.5 shows the states of a compliance review as the developer sees them in the status bar. A review can be requested from the Hub, from the command palette or automatically when new files are created. While the panel is open, clicking the Violation state brings the existing review back instead of running a new one; the state returns to Idle once every violation has been handled."),
    ...B.figure("5-5-review-states.png", "Figure 5.5: State diagram of a compliance review (status bar)"),
    B.h3("5.5.2 Sequence Diagram: Reviewing a Code Change"),
    B.p("Figure 5.6 shows the main use case, reviewing the developer's uncommitted changes. The `DiffSummarizer` reduces the change to structural signals; the two compliance passes then run in parallel. Pass 1 retrieves the five most relevant accepted ADRs and asks the model for violations; Pass 2 asks the model to sort the new code into planned components, extensions and checked files. The `ComplianceAgent` validates both answers before they reach the panel, and the developer resolves each item individually."),
    ...B.figure("5-6-review-sequence.png", "Figure 5.6: Sequence diagram for reviewing a code change"),
    B.h3("5.5.3 Event-Driven Collaboration Diagram"),
    B.p("Figure 5.7 combines the classes of Section 5.3 with the events that make them collaborate. Events come from two sources outside the extension: the developer (commands, sidebar actions and panel forms) and the VS Code workspace (files created or changed). The `Orchestrator` dispatches four pipeline events (`PROJECT_INIT`, `PROMPT_SUBMITTED`, `CODE_GENERATED`, `MANUAL_REVIEW_REQUESTED`) and the decision, approval, role and regeneration requests; each agent box names the event that runs it. Changes flow back to the UI through the `onState` and `onDataChanged` hooks and the audit log's `onAppend` notification."),
    ...B.figure("5-7-event-collaboration.png", "Figure 5.7: Event-driven collaboration diagram"),
  ];
}
