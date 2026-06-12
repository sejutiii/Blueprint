# BluePrint: Project Planning Document

---

## 1. Project Overview

BluePrint is a VSCode extension that enables **human-in-the-loop, architecture-aware AI-assisted software development** by maintaining persistent architectural knowledge throughout a project's lifecycle.

The tool takes as input:
- The project's system description
- Developer prompts
- Generated code changes (via file diff trigger)
- Architectural decisions made during development

It produces and continuously updates:
- An architectural blueprint (`ARCH.md`)
- A knowledge base of Architectural Decision Records (ADRs)

---

## 2. Problem Statement

Maintaining architectural consistency in software projects is increasingly difficult when AI code generation tools (GitHub Copilot, Cursor, Claude Code) are involved. Three major problems arise:

1. **Architectural Drift** — Minor prompt adjustments can create entirely new, unplanned infrastructure. These consequences accumulate unnoticed over time.
2. **Context Degradation** — Design intent is lost across sessions, leading to quality deterioration as projects grow.
3. **Loss of Developer Control** — AI agents make implicit architectural decisions, stripping developers of ownership. The rationale behind critical design decisions is lost.

---

## 3. Proposed Solution

BluePrint follows a **Constraints → Conformance → Knowledge** cycle:

- **Constraints:** Help the developer define architectural constraints upfront.
- **Conformance:** Ensure generated code follows those constraints.
- **Knowledge:** Build a persistent knowledge base of every architectural decision made.

---

## 4. System Architecture: Multi-Agent Design

The system is designed as a **multi-agent system** with four specialized agents coordinated by a central orchestrator. The VSCode extension acts as the UI shell.

```
Developer (VSCode UI)
        |
  Orchestrator Agent
   /       |       |       \
Arch   Constraint  Compliance  Retrieval
Agent    Agent      Agent       Agent
              |
        ADR Store + ARCH.md
```

### Agent Responsibilities

| Agent | Responsibility |
|---|---|
| Orchestrator | Routes events, manages state, composes developer notifications |
| Architecture Agent | Generates and updates ARCH.md |
| Constraint Elicitation Agent | Conducts structured conversation to surface constraints as ADRs |
| Compliance Agent | Checks generated code against constraints and ADRs (two passes) |
| Retrieval Agent | Fetches relevant past ADRs as context using semantic similarity |

---

## 5. Component Details

### 5.1 Orchestrator

- Implemented as a **state machine** with well-defined triggers: `PROJECT_INIT`, `PROMPT_SUBMITTED`, `CODE_GENERATED`, `MANUAL_REVIEW_REQUESTED`
- Each trigger maps to an agent pipeline (e.g., `CODE_GENERATED` → Retrieval Agent → Compliance Agent → Extension Detection)
- Manages what to display to the developer at each step
- Keeps itself thin — routes and assembles context, does no heavy reasoning

---

### 5.2 Architecture Agent

**5.2a Initial ARCH.md Generation**
- Triggered when the developer provides a natural language system description
- Prompts an LLM with a structured template to extract: components, responsibilities, relationships, tech stack choices, cross-cutting concerns (auth, logging, data flow)
- Uses structured JSON output internally before rendering to Markdown, so downstream agents can parse it programmatically
- Output is a structured `ARCH.md` with sections: *System Overview, Components, Data Flow, Constraints, Open Questions*

**5.2b Incremental Updates**
- Performs targeted diff-and-patch edits rather than regenerating the entire file, preserving manual developer edits
- Commits the old version to local history before patching (reversible changes)
- Triggered when a developer approves a detected architectural extension

---

### 5.3 Constraint Elicitation Agent

- Conversational agent that runs at project setup
- Uses a **branching dialogue** — answers to one question determine what to ask next
- Question sequence: technology constraints → scalability expectations → team conventions → integration requirements → non-functional requirements (security, performance)
- Each surfaced constraint is drafted as an ADR and shown to the developer for approval before saving
- Developer can edit each draft before it is committed

**ADR Schema (MADR format):**
```
ID, Title, Status, Context, Decision, Consequences, Timestamp
```

ADRs are stored as:
- Individual Markdown files in `/docs/adr/`
- Structured JSON in a local index file for fast retrieval

---

### 5.4 Compliance Agent

The most critical agent. Runs in **two passes** after code is generated.

**Pass 1: Violation Detection**
- Input: generated code diff (summarized) + parsed ARCH.md constraints + top-K relevant ADRs from Retrieval Agent
- LLM acts as an architectural reviewer with constraints provided explicitly (not raw ARCH.md prose)
- Returns structured output: `{violation: boolean, violations: [{constraint_id, description, severity, affected_code_location}]}`
- If violations found: developer sees a decision panel with two options — **Update Architecture** or **Modify Code** — and provides reasoning saved as a new ADR

**Pass 2: Extension Detection** (only runs if Pass 1 finds no violation)
- Asks the LLM whether the code introduces any new structural element absent from ARCH.md but not contradicting it
- If yes: developer confirms and provides reasoning → new ADR created → Architecture Agent updates ARCH.md
- The two-pass design is intentional — conflating violations with extensions causes developer confusion

**Pre-generation Prompt Check (optional)**
- Developer can run a pre-check before submitting a prompt to the AI coder
- Compliance Agent checks the natural language prompt against existing ADRs and ARCH.md constraints
- Lighter-weight than post-generation checking: semantic similarity + reasoning task

---

### 5.5 Retrieval Agent (RAG Component)

- Embeds every ADR using a text embedding model at creation time
- Stores embeddings locally (ChromaDB or flat file with cosine similarity — sufficient for project-scale data)
- At query time: embeds the current code diff + developer prompt and retrieves top-K most similar ADRs
- Also applies keyword-based filter on component names mentioned in the code, so structurally relevant but semantically distant ADRs are not missed
- Tracks which ADRs were used as context for each compliance check, enabling decision traceability

---

### 5.6 VSCode Extension (UI Shell)

The developer-facing interface. Does no reasoning — surfaces agent outputs and captures developer inputs.

**Key UI Surfaces:**

| Panel | Purpose |
|---|---|
| Setup Wizard | Collects system description, starts Constraint Elicitation Agent |
| Pre-check Button | Runs prompt-level conflict detection before submitting to AI coder |
| Post-generation Panel | Shows compliance results with reasoning input box |
| ARCH.md Viewer | Webview rendering current architecture with highlights on touched sections |
| ADR Browser | Sidebar tree view of all ADRs, searchable, with status badges |
| Decision Audit Trail | Timeline of all architectural decisions made in the project |

---

## 6. Code Change Detection: File Diff Trigger

**Chosen approach: File Diff Trigger** (triggered by developer clicking a "Review this change architecturally" button after code generation).

### Why File Diff Trigger

- **AI-tool agnostic** — works regardless of whether the developer used Claude Code, Copilot, Cursor, or wrote code manually
- Does not require integration with any specific AI coding tool's API
- Future-proof as new AI coding tools emerge

### Why Not Other Options

- **Manual paste** — relies on developer discipline; they will skip it under time pressure
- **API hook** — requires separate integration per tool; Copilot has no public API for this; high maintenance cost

### Trigger Timing

Triggering on every save is too noisy. Triggering on git commit is too late. The chosen approach:
- A **deliberate "Review" button** in the VSCode UI that the developer clicks when they are done with a change
- Also auto-trigger when a **new file is created**, as this almost always implies an architectural decision

### Diff Pipeline

Raw diffs are too large and noisy for direct LLM consumption. The pipeline is:

```
File saved → Diff computed → Diff summarized → Orchestrator → Compliance Agent
```

**Diff Summarization Step:** Rule-based or LLM-based extraction of structural signals only — new imports, new class/function signatures, new dependencies added to `package.json`, new files created. This keeps compliance checks focused and LLM costs manageable.

---

## 7. Data Model

Everything lives locally inside the project repository — version-controlled, diffable, and portable.

```
/your-project
  /docs
    ARCH.md                    ← human-readable architecture
    /adr
      0001-use-postgres.md
      0002-rest-not-graphql.md
      ...
  /.blueprint
    arch.json                  ← parsed/structured ARCH.md for agents
    adr-index.json             ← metadata + embeddings index
    history.json               ← audit trail of all checks and decisions
```

---

## 8. LLM Strategy: Free API Tier

Paid LLM APIs will not be used. The tool must work entirely on free-tier LLM APIs.

### Candidate Free APIs

| Option | Strengths | Weaknesses |
|---|---|---|
| **Google Gemini API (free tier)** | Best reasoning quality; 1M token context window; generous rate limits | Rate limits on heavy use |
| **Groq (free tier)** | Very fast inference; runs Llama 3, Mixtral | Weaker reasoning than Gemini on complex tasks |
| **OpenRouter (free models)** | Aggregates multiple free models; useful as fallback | Variable quality |
| **Ollama (fully local)** | No API calls, no rate limits, no cost | Requires developer hardware (8GB+ VRAM); smaller models |

**Recommended primary:** Google Gemini API (free tier) for heavy reasoning tasks.

### Design Principles to Compensate for Model Limitations

1. **Highly structured prompts** — numbered steps, explicit JSON output schema, few-shot examples. Smaller models are far more reliable with well-formatted prompts.
2. **Chain-of-thought decomposition** — break complex reasoning into smaller steps (e.g., first extract changed structural elements, then compare each against constraints individually).
3. **Minimize what the model reasons about** — use rule-based and keyword pre-filtering before any LLM call. The model handles final judgment, not broad search.
4. **Embeddings handle retrieval, not the LLM** — the Retrieval Agent uses local embedding similarity. LLM is only called for the final reasoning step.

### Two-Tier Model Strategy

| Tier | Tasks | Model |
|---|---|---|
| Light | Diff summarization, keyword extraction, ADR drafting | Small/fast free model or rule-based |
| Heavy | Compliance checking, extension detection, ARCH.md generation | Best available free model (Gemini Flash) |

### Managing Imperfect Accuracy

Even with good prompt engineering, a free model will miss subtle violations. This is handled by:
- Designing the UI to make developer review fast and easy — the tool surfaces the right questions; the developer makes the final call
- Framing the tool's value as improving the **overall human-in-the-loop workflow**, not achieving perfect model accuracy
- Evaluation metric: does the workflow catch more architectural drift than without the tool — not raw model accuracy

---

## 9. Recommended Build Order

Given SPL-3 time constraints, build in this order to ensure a working vertical slice is available early:

1. **ARCH.md generation from system description** — immediate visible output; validates the core LLM pipeline
2. **ADR data model and storage** — everything else depends on this
3. **Constraint Elicitation Agent** — populates the ADR store
4. **Compliance Agent (Pass 1 only — violation detection)** — the highest-value feature
5. **Retrieval Agent** — upgrades compliance checking with persistent memory
6. **Compliance Agent (Pass 2 — extension detection)**
7. **VSCode UI panels** — can be built in parallel with agents once interfaces are defined
8. **Pre-check (prompt-level conflict detection)** — polish feature, add last

---

## 10. Key Technical Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Free LLM rate limits hit during heavy use | Two-tier model strategy; minimize LLM calls with rule-based pre-filtering |
| Diff too large/noisy for LLM context | Diff summarization step before any agent call |
| Model misses subtle architectural violations | Human-in-the-loop design; developer review is always the final gate |
| VSCode API limitations for intercepting AI-generated code | File diff trigger is AI-tool agnostic; no dependency on specific tool APIs |
| ARCH.md manual edits overwritten by agent updates | Targeted patch edits only; full version history maintained before any update |


