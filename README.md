# BluePrint

**Architecture-aware AI-assisted development for VS Code.**

AI coding assistants make architectural decisions on your behalf: a new database client here, an unplanned service there. Each change looks small, the reasons are never written down, and after a few weeks nobody can say what the architecture is or why. BluePrint keeps a living record of your architecture inside the repository and checks every change against it.

It works in a cycle of **Constraints → Conformance → Knowledge**:

- **Constraints.** Describe your system once. BluePrint drafts an architecture document (`docs/ARCH.md`) and asks a few guided questions to record the decisions that are already fixed, as Architectural Decision Records (ADRs).
- **Conformance.** Before you prompt an AI assistant, pre-check the prompt against those decisions. After code is written, review the uncommitted changes: BluePrint reports code that violates a decision, and new components the architecture doesn't describe yet.
- **Knowledge.** Every resolution is recorded: a new ADR, an updated ARCH.md, an audit-trail entry. All of it lives in the repo, so it is reviewed, versioned and shared like code.

<!-- Screenshot: the Hub after initialization -->

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [LLM providers and your API key](#llm-providers-and-your-api-key)
- [What is sent to the model](#what-is-sent-to-the-model)
- [Files BluePrint keeps in your repo](#files-blueprint-keeps-in-your-repo)
- [Teams and roles](#teams-and-roles)
- [Commands](#commands)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Building from source](#building-from-source)
- [Known limitations](#known-limitations)

## Features

**Architecture from a description.** A four-step wizard: pick an LLM provider, set up team roles, describe your system, and answer up to five guided questions (technology choices, scalability, team conventions, integrations, security). Each answer can prompt one follow-up question and becomes at most one ADR, which you can edit before saving.

**Compliance review of your changes.** *Review This Change Architecturally* reads everything uncommitted in the git repository (new, modified, renamed and deleted files) and runs two checks in parallel:

- **Violations.** Does the change contradict an accepted decision? Each violation is resolved on its own: either *Modify Code* (fix it and review again, nothing is recorded) or *Update Architecture* (accept the change with your reasoning, which becomes a new ADR and updates ARCH.md).
- **New components.** Code that the architecture doesn't describe is reported as an extension you can register (one ADR plus a new row in ARCH.md) or dismiss. Code that *is* a component ARCH.md lists as planned is marked **Implemented**, with no ADR needed.

A review can also start on its own when you create new files (this can be turned off).

**Prompt pre-check.** Paste the prompt you're about to give an AI assistant. BluePrint finds the most relevant decisions, flags conflicts and suggests a revised prompt. *Copy prompt with context* puts the prompt together with the relevant ADRs and constraints on your clipboard, ready to paste into any assistant.

**Add Decision.** Write a decision or changed requirement in plain words (*"Checkout must now offer both Stripe and PayPal"*). BluePrint drafts an ADR and suggests which existing decision, if any, it replaces. The old ADR is marked superseded and its ARCH.md line is swapped.

**A living ARCH.md.** Approved decisions patch only the affected section of ARCH.md, so manual edits elsewhere are kept. The ARCH.md viewer highlights the sections touched by the last five changes and says when and why. Every version is kept, and you can revert to any of them with a diff preview. Architects can also regenerate the whole document from the current codebase.

**ADR browser and audit trail.** The sidebar lists decisions by status (accepted, pending approval, rejected, superseded), with search and filter. The audit trail records every review, pre-check, decision and ARCH.md change, and can be searched by file name.

<!-- Screenshot: Compliance panel with a violation and a detected component -->
<!-- Screenshot: Prompt pre-check with a conflict and a revised prompt -->

## Requirements

- VS Code 1.85 or later.
- **Git**, for compliance reviews: changes are compared against the last commit. Initialize and pre-check work without it.
- An API key for one of the supported LLM providers. Free tiers are enough to try BluePrint (see below).

## Getting started

1. Open your project folder and run **BluePrint: Open Hub** (or **BluePrint: Initialize Project**) from the Command Palette.
2. Choose a provider and paste your API key. BluePrint checks the key with one request before saving it.
3. Set up roles: *Just me*, *A team*, or *Skip*. See [Teams and roles](#teams-and-roles).
4. Describe your system in a few paragraphs: what it does, its main parts, the technology you've chosen. BluePrint generates `docs/ARCH.md`.
5. Answer the guided questions you have answers for, and skip the rest. Each one can become an ADR.
6. Write code as usual, with or without an AI assistant. Before committing, click **Review my changes** in the Hub, or run **BluePrint: Review This Change Architecturally**.

The status bar shows the result of the last review, and the **BluePrint** view in the activity bar holds the decision list and the recent audit trail.

> **Tip:** commit `docs/ARCH.md`, `docs/adr/` and `.blueprint/` along with your code. A teammate who pulls them gets the same decisions and reviews against the same architecture.

## LLM providers and your API key

BluePrint calls the model with your own API key. It is stored in VS Code's SecretStorage (the operating system's credential store) on your machine, and never written to the repository.

| Provider | Default model | Free tier | Get a key |
| --- | --- | --- | --- |
| Google Gemini | `gemini-flash-latest` | Yes | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Groq | `openai/gpt-oss-120b` | Yes | [console.groq.com/keys](https://console.groq.com/keys) |
| OpenRouter | `openrouter/free` | Yes | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Anthropic (Claude) | `claude-sonnet-4-6` | No | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| OpenAI | `gpt-4o-mini` | No | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

Providers retire models from time to time. If the default stops working, set another model in the `blueprint.model.<provider>` setting. Switch provider or key at any time with **BluePrint: Change LLM Provider / API Key**.

## What is sent to the model

- **Initialize:** your system description and your answers to the guided questions.
- **Pre-check:** your prompt, the architecture summary and the most relevant accepted ADRs (5 by default, see `blueprint.retrieval.topK`).
- **Review:** a summary of the change (changed files, new imports, function and class signatures, dependency changes) and an excerpt of the diff of up to 6,000 characters. Files that git ignores are never read.
- **Regenerate ARCH.md** (Architects only): a size-capped snapshot of the codebase: the file tree, dependency manifests, the README and declaration headers (imports, class and function signatures), not whole source files.

Finding the relevant ADRs is done locally. BluePrint blends keyword (TF-IDF) scoring with a small embedding model (`all-MiniLM-L6-v2`, about 23 MB), downloaded once on first use and run on your machine. Where the model isn't available, keyword scoring is used on its own.

## Files BluePrint keeps in your repo

```
docs/
  ARCH.md                  the architecture document; edit it freely
  adr/                     one Markdown file per decision (0001-use-postgresql.md)
.blueprint/
  arch.json                structured copy of ARCH.md
  adr-index.json           decision index: status, approvals, links between ADRs
  audit-log.json           the audit trail
  roles.json               Architects and Developers (optional)
  history/                 earlier versions of ARCH.md, for Revert
```

BluePrint never edits `.gitignore` or anything else outside these paths. It also leaves its own files out of compliance reviews.

## Teams and roles

`.blueprint/roles.json` lists **Architects** and **Developers** by git email (`git config user.email`):

- **Architects** approve or reject decisions, initialize the project, change roles, regenerate ARCH.md and revert it.
- **Developers** can review, pre-check and propose decisions. Their decisions wait in a pending queue and change ARCH.md only once an Architect approves them.

Without a `roles.json`, or with no Architects named, everyone is an Architect. Set roles up in the wizard or with **BluePrint: Configure Team & Roles**.

> **Roles run on the honour system.** BluePrint reads `roles.json` but cannot stop anyone from editing it. Protect it the way you protect code: with code review, for example a `CODEOWNERS` entry for `.blueprint/roles.json` that requires an Architect's approval.

## Commands

All commands are in the Command Palette under **BluePrint:**. The most common ones are also on the Hub and in the sidebar.

| Command | What it does |
| --- | --- |
| Open Hub | Dashboard: your role, pending approvals, the main actions |
| Initialize Project | The setup wizard (asks for confirmation before replacing an existing ARCH.md) |
| Review This Change Architecturally | Compliance review of all uncommitted changes |
| Pre-Check Prompt Against Architecture | Check a prompt before giving it to an AI assistant |
| Add Decision (ADR) | Draft a decision from plain text |
| Answer Constraint Questions | The guided questions on their own, without regenerating ARCH.md |
| View Architecture (ARCH.md) | Rendered ARCH.md with recent changes highlighted |
| Open ADR Browser / Search ADRs / Filter ADR Browser | Browse, jump to or narrow down decisions |
| Approve / Reject Pending Decision | Architects only |
| View Decision Audit Trail | Searchable history of reviews, pre-checks and decisions |
| Revert ARCH.md to Earlier Version | Architects only; shows a diff first |
| Regenerate ARCH.md from Codebase | Architects only; constraints are always kept |
| Configure Team & Roles | Edit `roles.json` in a form |
| Change LLM Provider / API Key | Switch provider or replace the key |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `blueprint.autoReviewOnNewFile` | `true` | Offer a review when new files are created |
| `blueprint.retrieval.topK` | `5` | How many accepted ADRs (1–20) are sent to the model as context in reviews, pre-checks and Add Decision. A higher number catches more conflicts but makes requests longer and costlier. |
| `blueprint.model.gemini`, `.groq`, `.openrouter`, `.anthropic`, `.openai` | *(empty)* | Model to use with that provider; empty means the default in the table above |

## How it works

BluePrint is a set of small agents coordinated by an orchestrator. Each agent makes one model call or does one local job:

```
Initialize   →  Architecture Agent ─→ ARCH.md
                Constraint Elicitation Agent ─→ ADR drafts

Pre-check    →  Retrieval Agent (local) ─→ Pre-Check Agent ─→ conflicts + revised prompt

Review       →  git diff ─→ Diff Summarizer (Tree-sitter) ─┬─→ Retrieval Agent ─→ Compliance Pass 1 (violations)
                                                           └─→ Compliance Pass 2 (new components)
```

- **Diff Summarizer.** It reads `git diff` plus untracked files and parses changed code with Tree-sitter (TypeScript, TSX, JavaScript, Python, Java, Go, C#, Rust) to pull out imports and signatures. Other languages fall back to pattern matching. Dependency changes are read from `package.json`, `requirements.txt` and `go.mod`.
- **Retrieval Agent.** It ranks accepted ADRs by blended keyword and embedding similarity, with a boost when the ADR and the change name the same component.
- **Decision Service.** Every decision goes through it: role checks, the approval queue, the ADR file, the targeted ARCH.md patch and the audit entry.

Model replies are validated before use, so a malformed reply produces safe defaults rather than a broken panel. Requests time out and retry on rate limits and server errors.

## Building from source

Requires Node.js 18 or later and git.

```bash
git clone https://github.com/sejutiii/Blueprint.git
cd Blueprint
npm install
npm run build        # bundle to dist/
```

Press **F5** in VS Code to start an Extension Development Host with BluePrint loaded.

| Script | Purpose |
| --- | --- |
| `npm test` | Unit and integration tests (vitest) |
| `npm run typecheck` | TypeScript check of the extension and the tests |
| `npm run lint` | ESLint |
| `npm run watch` | Rebuild on change |
| `npm run package` | VSIX for the current platform, written to `out/` |
| `npm run package:all` | VSIXs for every supported platform, plus a universal one |

The embedding runtime (onnxruntime) is native code, so each platform gets its own package: Windows x64/arm64, Linux x64/arm64 and macOS arm64. The **universal** package covers every other platform (Intel Macs, for example). It has no embedding runtime and finds relevant ADRs by keyword scoring alone.

For local development you can set `BLUEPRINT_DEFAULT_PROVIDER` (for example `groq`) and `BLUEPRINT_DEFAULT_API_KEY` in a `.env` file at the repo root, which lets the wizard skip the API-key step. Only development builds (`npm run build`) read it. Production builds never do, and packaging fails if anything that looks like a key ends up in the bundle. `.env` is git-ignored and never packaged.

## Known limitations

- Compliance reviews need a git repository. A fallback for folders without git is planned.
- Only the Windows x64 package has been tested end to end so far. The Linux and macOS packages build but have not been run.
- Initialize builds ARCH.md from your description alone, so in a project that already has code every component starts as *Planned*. Components become *Implemented* when a review sees their code, or when an Architect regenerates ARCH.md from the codebase.
- Model judgments vary from run to run. Treat a review as a careful second opinion, not a proof.
