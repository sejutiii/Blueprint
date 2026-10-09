// Section 8: User manual. `B` holds the document building blocks (see build-report.mjs).
export function section8(B) {
  return [
    B.h1("8 User Manual"),
    B.p("This section explains how to install BluePrint, set it up for a project and use it day to day. It is written for developers who already use Visual Studio Code (VS Code). Screenshots of every panel mentioned here are in Section 6.3; the figure numbers are given in brackets."),

    // ── 8.1 ───────────────────────────────────────────────────────────────────
    B.h2("8.1 System Requirements"),
    B.bullet("**Visual Studio Code** version 1.85 or later."),
    B.bullet("**Operating system:** Windows (x64 or ARM64), Linux (x64 or ARM64) or macOS on Apple silicon. Other systems, such as macOS on Intel, use the universal package (Section 8.2)."),
    B.bullet("**Git**, with the project folder initialised as a git repository. Compliance reviews compare the project with its last commit, so they find nothing to check without git."),
    B.bullet("**An API key** for one of the supported language-model providers: Google Gemini, Groq, OpenRouter, Anthropic or OpenAI (Section 8.3). Gemini, Groq and OpenRouter offer free tiers."),
    B.bullet("**An internet connection** for the language-model calls. On first use BluePrint also downloads a small embedding model (about 23 MB) for ranking ADRs; if this is not possible it falls back to word-based ranking automatically."),
    B.bullet("For multi-person projects, each team member's `git config user.email` should be set, since roles are assigned by e-mail address."),

    // ── 8.2 ───────────────────────────────────────────────────────────────────
    B.h2("8.2 Installation"),
    B.p("BluePrint is distributed as a VS Code extension package (a `.vsix` file). One package is built for each platform, because each carries the native runtime of the local embedding model for that platform only; the universal package has no native code and works everywhere, ranking ADRs by words alone. Choose the package from Table 8.1."),
    ...B.table("Table 8.1: Installation packages", ["Package", "Platform", "Notes"], [
      ["`blueprint-win32-x64.vsix`", "Windows, Intel or AMD 64-bit", "Most Windows PCs"],
      ["`blueprint-win32-arm64.vsix`", "Windows on ARM", ""],
      ["`blueprint-linux-x64.vsix`", "Linux, 64-bit", ""],
      ["`blueprint-linux-arm64.vsix`", "Linux on ARM", ""],
      ["`blueprint-darwin-arm64.vsix`", "macOS on Apple silicon (M1 and later)", ""],
      ["`blueprint-universal.vsix`", "Any platform", "No local embedding model; ADRs are ranked by words only"],
    ], [4.0, 3.6, 2.6]),
    B.h3("8.2.1 Installing a package"),
    B.p("To install from within VS Code:"),
    B.step("Open the Extensions view (`Ctrl+Shift+X`, or `Cmd+Shift+X` on macOS)."),
    B.step("Click the **…** (Views and More Actions) menu at the top of the view and choose **Install from VSIX…**."),
    B.step("Select the downloaded `.vsix` file and confirm. Reload VS Code if it asks."),
    B.p("Alternatively, install from a terminal with `code --install-extension blueprint-win32-x64.vsix` (using the file name of the chosen package)."),
    B.h3("8.2.2 Building from source"),
    B.p("Developers who want to build the packages themselves need Node.js 20 or later and npm:"),
    B.step("Clone the repository and run `npm install` in its root folder.", { restart: true }),
    B.step("Run `npm run package` to build the package for the current platform, or `npm run package:all` for every platform. The packages are written to the `out/` folder."),
    B.step("Install the package as in Section 8.2.1. To try the extension without installing it, open the repository in VS Code and press `F5`; this starts an Extension Development Host window with BluePrint loaded."),
    B.p("`npm test` runs the automated tests, and `npm run typecheck` and `npm run lint` run the static checks."),
    B.h3("8.2.3 Checking the installation"),
    B.p("After installation, a BluePrint icon appears in the Activity Bar on the left of the window, and the status bar at the bottom reads **BluePrint: Not initialized** whenever a folder is open (Figure 6.4). Clicking that item opens the Hub, from which the project is initialised."),

    // ── 8.3 ───────────────────────────────────────────────────────────────────
    B.h2("8.3 Obtaining an API Key"),
    B.p("BluePrint sends its requests to a language-model provider using the developer's own API key. Create a key at one of the pages in Table 8.2; the setup wizard also links to the right page for the chosen provider. The key is stored in VS Code's encrypted secret storage on the developer's machine, never in the project's files, so each team member uses their own key."),
    ...B.table("Table 8.2: Supported providers", ["Provider", "Where to create a key", "Default model", "Free tier"], [
      ["Google Gemini", "aistudio.google.com/apikey", "`gemini-flash-latest`", "Yes"],
      ["Groq", "console.groq.com/keys", "`openai/gpt-oss-120b`", "Yes"],
      ["OpenRouter", "openrouter.ai/keys", "`openrouter/free`", "Yes (free models)"],
      ["Anthropic", "console.anthropic.com/settings/keys", "`claude-sonnet-4-6`", "No"],
      ["OpenAI", "platform.openai.com/api-keys", "`gpt-4o-mini`", "No"],
    ], [1.7, 3.2, 2.6, 1.5]),
    B.p("A different model can be chosen for each provider in the settings (Section 8.8). The provider or key can be changed at any time with **BluePrint: Change LLM Provider / API Key**."),

    // ── 8.4 ───────────────────────────────────────────────────────────────────
    B.h2("8.4 Setting Up a Project"),
    B.p("Open the project folder in VS Code (**File → Open Folder…**). If the folder is not yet a git repository, run `git init` in it first. Then start the setup wizard by clicking **BluePrint: Not initialized** in the status bar and choosing **Initialize**, or by running **BluePrint: Initialize Project** from the command palette (`Ctrl+Shift+P`). The wizard has four steps (Figures 6.7 and 6.8):"),
    B.step("**LLM provider.** Choose a provider, paste the API key and click **Next**. BluePrint sends one short test request; if the key is rejected, the model is unavailable or the provider's project is blocked, the wizard says so and the key is not saved.", { restart: true }),
    B.step("**Team and roles.** This step appears only if the project has no roles file yet. Choose **Just me** (you become the only Architect), **A team** (list the other Architects and, optionally, the Developers, one e-mail per line) or **Skip for now** (everyone is an Architect). Roles are explained in Section 8.6."),
    B.step("**Describe your system.** Enter a project name and describe the system in plain language: what it does, its main parts, and the technologies already chosen. Click **Generate Architecture**. After 10 to 30 seconds BluePrint writes `docs/ARCH.md` with the components, data flow, constraints and open questions it found; every component starts as *Planned*."),
    B.step("**Surface constraints.** Click **Surface Constraints** to answer up to five questions about the architecture (for example data storage or external services), or **Done** to skip them. For each concrete answer BluePrint may ask one follow-up and then drafts a single ADR covering both answers. Edit the draft's title, context, decision and consequences as needed, then **Save ADR** or **Discard**. Tentative answers (\"not sure yet\") produce no ADR, and **Skip** moves to the next question."),
    B.p("When the wizard finishes, the BluePrint sidebar appears and the status bar shows **BluePrint**. The files in Table 8.3 are created. They belong to the project: commit them so that the whole team shares the same architecture and decisions."),
    ...B.table("Table 8.3: Files created by BluePrint in the project", ["File or folder", "Contents"], [
      ["`docs/ARCH.md`", "The architecture document, readable on its own and safe to edit by hand"],
      ["`docs/adr/0001-<title>.md`, …", "One Markdown file per Architectural Decision Record"],
      ["`.blueprint/arch.json`", "The architecture in structured form, kept in step with ARCH.md"],
      ["`.blueprint/adr-index.json`", "Index of all ADRs with their status and cached embeddings"],
      ["`.blueprint/roles.json`", "The team's Architects and Developers (if roles were set up)"],
      ["`.blueprint/audit-log.json`", "The decision audit trail"],
      ["`.blueprint/history/`", "Earlier versions of ARCH.md, used by Revert"],
    ], [3.5, 6.0]),

    // ── 8.5 ───────────────────────────────────────────────────────────────────
    B.h2("8.5 Using BluePrint"),
    B.p("The **Hub** (Figure 6.6) is the starting point for every task. Open it by clicking BluePrint in the status bar, with the BluePrint button in the editor title bar, or with **BluePrint: Open Hub**. Every task is also available as a `BluePrint:` command in the command palette (Table 8.5)."),

    B.h3("8.5.1 Checking a prompt before coding"),
    B.p("Use the Pre-Check before asking an AI assistant to write code, to catch a request that would break an architectural decision (Figure 6.12)."),
    B.step("In the Hub, click **Pre-check a prompt** (or run **BluePrint: Pre-Check Prompt Against Architecture**).", { restart: true }),
    B.step("Type or paste the prompt you intend to give the assistant and click **Check Architecture** (or press `Ctrl+Enter`)."),
    B.step("If conflicts are found, the panel lists each concern with the ADR it relates to and suggests a revised prompt; click **Use this prompt** to adopt it, or **Revise prompt** to edit your own."),
    B.step("Choose the ADRs to include and click **Copy prompt with context**. Paste the copied text into the AI assistant, so that it sees the relevant decisions and constraints along with the request."),

    B.h3("8.5.2 Reviewing code changes"),
    B.p("A compliance review checks every uncommitted change in the project (staged, unstaged and new untracked files; files ignored by `.gitignore` are skipped) against ARCH.md and the accepted ADRs. Start a review in any of three ways:"),
    B.bullet("click **Review my changes** in the Hub, or run **BluePrint: Review This Change Architecturally**;"),
    B.bullet("click **Review** in the notification *\"New file detected — review architectural impact?\"* that appears when new files are created (this can be turned off, Section 8.8);"),
    B.bullet("click **BluePrint: Violation** in the status bar, which brings back the last review."),
    B.p("The Compliance Review panel (Figures 6.9 to 6.11) shows four kinds of result. Resolve each item with the buttons on its card:"),
    ...B.table("Table 8.4: Compliance review results and how to resolve them", ["Result", "Meaning", "Actions"], [
      ["Violation", "The change breaks a constraint or an accepted ADR; shown with its severity and location", ["• **Update Architecture:** the change is intended; give the reason and BluePrint records an ADR that updates the architecture.", "• **Modify Code:** the change is a mistake; fix the code and click **Re-run review**. Nothing is recorded."]],
      ["Planned component now in code", "The change implements a component that ARCH.md lists as Planned", ["• **Mark as Implemented:** ARCH.md shows the component as Implemented with its files; no ADR is needed.", "• **It's a New Component Instead**, if BluePrint matched the wrong component."]],
      ["New component", "The change adds something that is neither planned nor implemented", ["• **Register:** add it to ARCH.md and record an ADR, optionally with extra context.", "• **Dismiss**, if it is not architecturally significant."]],
      ["Checked file", "An added file that was examined and found not to be a new component, with the reason", ["• **Register as new component anyway**, to overrule the verdict."]],
    ], [2.0, 3.2, 4.8]),
    B.p("When every violation is handled, the status bar returns to its normal state. If the panel reports *No changes found*, it explains why: the folder is not a git repository, the folder is ignored by an enclosing repository, or there really are no uncommitted changes."),

    B.h3("8.5.3 Recording a decision"),
    B.p("Decisions made outside a review, for example in a design discussion, are recorded with **Add a decision** in the Hub, the **+** button of the Architectural Decisions view, or **BluePrint: Add Decision (ADR)** (Figure 6.13). Describe the decision in plain words; BluePrint drafts an ADR to edit before clicking **Save ADR**. If the decision replaces an existing one, choose that ADR (BluePrint may suggest it): the old ADR is marked superseded and its constraint in ARCH.md is replaced. The wizard's constraint questions can be answered again at any time with **BluePrint: Answer Constraint Questions**."),

    B.h3("8.5.4 Browsing decisions and the audit trail"),
    B.p("The BluePrint sidebar (Figure 6.5) has two views. **Architectural Decisions** lists every ADR grouped by status, with decisions awaiting approval first; click an ADR to open it. The buttons at the top of the view add a decision, **search** for one ADR by text, **filter** the list, and clear the filter. **Audit Trail** lists the 20 most recent events; the full trail (Figure 6.15) has a Decisions tab and an Activity tab, with search and filters, and links to the ADRs and changed files of each event."),

    B.h3("8.5.5 Viewing and maintaining ARCH.md"),
    B.p("Click **View architecture** in the Hub to open the ARCH.md Viewer (Figure 6.14). It shows the rendered document with the sections changed by the five most recent changes highlighted, and why each change was made; the Components table shows which components are Planned and which are Implemented. **Edit source** opens the Markdown file; manual edits are kept when BluePrint later updates the document. Architects can also **Revert** ARCH.md to an earlier version (a diff is shown before confirming) and **Regenerate** it from the current codebase, which rewrites the components and data flow while keeping every constraint. ARCH.md is saved to the history before every change, so a regeneration can be undone with Revert."),

    // ── 8.6 ───────────────────────────────────────────────────────────────────
    B.h2("8.6 Working in a Team"),
    B.p("BluePrint has two roles, identified by each person's `git config user.email`. **Architects** approve decisions, and their own decisions take effect at once. **Developers** can use every feature, but the decisions they record wait in an approval queue and change nothing in ARCH.md until an Architect approves them. If no roles are set up, everyone is an Architect. The status bar tooltip and the title of the Architectural Decisions view show the current user's role."),
    B.step("An Architect sets up the roles in the wizard, or later with **BluePrint: Configure Team & Roles** (Figure 6.16), and commits `.blueprint/roles.json` together with `docs/`.", { restart: true }),
    B.step("Team members pull the repository and install BluePrint with their own API key (**BluePrint: Change LLM Provider / API Key**). The project is already initialised, so they do not run the wizard."),
    B.step("When a Developer records a decision, it appears under *Pending approval* in the sidebar, the status bar shows the number of pending decisions, and the Hub shows a banner."),
    B.step("An Architect opens the pending ADR and clicks **Approve** or **Reject** (the check and cross buttons on the item, or the commands of the same name). A rejection needs a reason. On approval, ARCH.md is updated and the event is recorded in the audit trail."),
    B.p("Changes that teammates push (new ADRs, approvals, edited roles) appear in the sidebar and the open panels within about a second of a `git pull`, without reloading. Roles are an agreement rather than a lock: anyone who can push can edit `roles.json`, so protect it with code review, for example a CODEOWNERS rule."),

    // ── 8.7 ───────────────────────────────────────────────────────────────────
    B.h2("8.7 Command Reference"),
    ...B.table("Table 8.5: BluePrint commands (command palette)", ["Command", "What it does", "Who"], [
      ["Initialize Project", "Runs the setup wizard (asks before overwriting an existing ARCH.md)", "Architects, once roles exist"],
      ["Open Hub", "Opens the Hub", "Everyone"],
      ["Review This Change Architecturally", "Runs a compliance review of the uncommitted changes", "Everyone"],
      ["Pre-Check Prompt Against Architecture", "Checks a prompt for an AI assistant against the decisions", "Everyone"],
      ["View Architecture (ARCH.md)", "Opens the ARCH.md Viewer", "Everyone"],
      ["Add Decision (ADR)", "Drafts an ADR from a plain-language description", "Everyone"],
      ["Answer Constraint Questions", "Reopens the wizard's constraint questions", "Everyone"],
      ["Open ADR Browser / Search ADRs / Filter ADR Browser / Clear ADR Filter", "Shows, searches and filters the list of decisions", "Everyone"],
      ["View Decision Audit Trail", "Opens the full audit trail", "Everyone"],
      ["Approve / Reject Pending Decision", "Accepts or rejects a decision awaiting approval", "Architects"],
      ["Revert ARCH.md to Earlier Version", "Restores an earlier ARCH.md after showing the difference", "Architects"],
      ["Regenerate ARCH.md from Codebase", "Rewrites ARCH.md from the current code, keeping constraints", "Architects"],
      ["Configure Team & Roles", "Shows the roles; Architects can edit them", "Everyone (edit: Architects)"],
      ["Change LLM Provider / API Key", "Changes the provider and key on this machine", "Everyone"],
    ], [3.4, 4.6, 2.0]),

    // ── 8.8 ───────────────────────────────────────────────────────────────────
    B.h2("8.8 Settings"),
    B.p("Open **File → Preferences → Settings** and search for *BluePrint*."),
    ...B.table("Table 8.6: BluePrint settings", ["Setting", "Default", "Effect"], [
      ["`blueprint.autoReviewOnNewFile`", "On", "Offer a review when new files are created in the workspace"],
      ["`blueprint.model.gemini`, `.groq`, `.openrouter`, `.anthropic`, `.openai`", "Empty (built-in default, Table 8.2)", "The model to use with that provider; set it if the default model is retired or a different model is wanted"],
    ], [3.8, 2.4, 3.8]),

    // ── 8.9 ───────────────────────────────────────────────────────────────────
    B.h2("8.9 Troubleshooting"),
    ...B.table("Table 8.7: Common problems and solutions", ["Problem", "Cause and solution"], [
      ["The review says *No changes found*", "Read the reason shown. If the folder is not a git repository, run `git init`. If it is ignored by an enclosing repository, give the project its own repository. Otherwise there are no uncommitted changes to review."],
      ["The API key is rejected", "Check that the key was copied completely and belongs to the chosen provider. If the message says the project has been denied access, the key is valid but the provider has blocked its project; create a key in a new project or use another provider."],
      ["*Model not found* (HTTP 404)", "The provider has retired the default model. Set `blueprint.model.<provider>` to a current model name (Section 8.8)."],
      ["*Rate limit* or time-out errors", "BluePrint retries automatically; if it still fails, wait a minute and click **Try again**, or switch to another provider."],
      ["Approve, Reject, Revert or Regenerate are missing", "These are Architect-only. Check the role in the status bar tooltip; an Architect can change it in Team & Roles."],
      ["The role shows *unknown*", "Set the git e-mail address with `git config user.email you@example.com`."],
      ["ADR ranking seems less accurate offline", "The embedding model could not be downloaded or loaded, so BluePrint uses word-based ranking. Connect to the internet once so the model can be downloaded, or install the package for your platform instead of the universal one."],
    ], [3.0, 7.0]),

    // ── 8.10 ──────────────────────────────────────────────────────────────────
    B.h2("8.10 Uninstalling"),
    B.p("Open the Extensions view, find BluePrint, and choose **Uninstall**. The project's files (`docs/ARCH.md`, `docs/adr/` and `.blueprint/`) are left in place; they are plain Markdown and JSON and remain readable without the extension. Delete them by hand to remove every trace of BluePrint from a project."),
  ];
}
