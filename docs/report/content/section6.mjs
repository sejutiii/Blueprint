// Section 6: Interface design. `B` holds the document building blocks (see build-report.mjs).
export function section6(B) {
  return [
    B.h1("6 Interface Design"),
    B.p("BluePrint has no window of its own: it lives inside Visual Studio Code and uses two kinds of interface. **Native VS Code elements** (a status bar item, two sidebar views, commands in the command palette, quick picks, input boxes and notifications) give quick access and show state at a glance. **Webview panels** (HTML pages that open beside the editor) hold the longer workflows: the Hub, the Setup Wizard, the Compliance Review, the Pre-Check, Add Decision, the ARCH.md Viewer, the Audit Trail and Team & Roles. Every panel uses VS Code's theme colours, so it matches the developer's light or dark theme, and each panel type opens only once (a second request brings the open panel to the front)."),

    // ── 6.1 ───────────────────────────────────────────────────────────────────
    B.h2("6.1 User Interface Objects and Actions"),
    B.p("Table 6.1 lists the interface objects identified during user-interface analysis and the actions (operations) each one offers. Figure 6.1 shows how the developer moves between them: the Hub is the main entry point, and the command palette reaches every action directly."),
    ...B.table("Table 6.1: User interface objects and their actions", ["Interface object", "Kind and location", "Actions (operations)"], [
      ["Status bar item", "Native: VS Code status bar", "Shows the state (not initialized, idle with pending-approval count, checking, OK, violation) and the user's role in the tooltip. Click opens the Hub, starts Initialize, or reopens the last review."],
      ["Editor title button", "Native: editor title bar (initialized projects only)", "Opens the Hub."],
      ["Commands", "Native: command palette (`BluePrint: …`)", "Initialize; Open Hub; Review This Change; Pre-Check Prompt; View Architecture; Add Decision; Answer Constraint Questions; Search, Filter or Clear the ADR filter; Approve or Reject (Architects); Revert or Regenerate ARCH.md (Architects); Configure Team & Roles; Change LLM Provider / API Key; View Audit Trail."],
      ["ADR Browser", "Native: sidebar tree view", "Lists ADRs grouped by status, pending approvals first. Open an ADR; add a decision (+); search; filter and clear the filter; approve or reject a pending ADR (Architects)."],
      ["Audit Trail (sidebar)", "Native: sidebar tree view", "Lists the 20 latest audit entries. Open the linked ADR or the full Audit Trail panel."],
      ["Hub", "Webview panel", "Initialize (before setup). Afterwards: Review my changes; Pre-check a prompt; View architecture; Add a decision; links to Audit trail, Team & roles and Change LLM provider; a banner for pending approvals opens the ADR Browser."],
      ["Setup Wizard", "Webview panel", "Choose the default or one's own API key; choose a provider and enter the key (validated before saving); set up team roles; describe the system; generate ARCH.md; answer, skip or analyse the constraint questions; edit, save or discard each draft ADR; open ARCH.md."],
      ["Compliance Review", "Webview panel", "For each violation: Update Architecture (with reasoning) or Modify Code. For each planned component now in code: Mark as Implemented, or It's a New Component Instead. For each new component: Register (with optional context) or Dismiss. For each checked file: Register as new component anyway. Re-run review, Check again, Try again."],
      ["Pre-Check", "Webview panel", "Enter a coding prompt; Check Architecture (or Ctrl+Enter); Use this prompt (the suggested revision); choose ADRs and Copy prompt with context; open an ADR; Revise prompt; Check another prompt."],
      ["Add Decision", "Webview panel", "Describe a decision in plain words; edit the drafted ADR; choose the existing decision it replaces (one may be suggested); Save ADR; edit the description; answer the guided questions instead; open the saved ADR."],
      ["ARCH.md Viewer", "Webview panel", "Read the rendered ARCH.md with the sections changed by the last five changes highlighted; Edit source; Revert to an earlier version and Regenerate from the codebase (both Architect-only)."],
      ["Audit Trail panel", "Webview panel", "Switch between the Decisions and Activity tabs; search; filter by status or event group; open ADRs and changed files."],
      ["Team & Roles", "Webview panel", "See one's identity and role; edit the lists of Architects and Developers (Architects only); Save roles; Edit roles.json directly."],
      ["Quick picks, inputs and notifications", "Native VS Code dialogs", "Change the provider (provider list, then a password box with a link to the key page); pick an ARCH.md version to revert to (with a diff); confirm a regeneration (with a diff); enter an approval or rejection note; answer the new-file prompt (Review or Skip)."],
    ], [1.8, 2.0, 5.6]),
    ...B.figure("6-1-navigation.png", "Figure 6.1: Interface objects and the navigation between them"),

    // ── 6.2 ───────────────────────────────────────────────────────────────────
    B.h2("6.2 Events and Interface State Changes"),
    B.p("Table 6.2 lists the events that change the state of the interface. Most are user actions; the rest come from the workspace (files created or changed, for example after `git pull`) or from the extension when a model call finishes. The extension keeps every view in step with the files on disk, so a change made by a teammate appears without reloading."),
    ...B.table("Table 6.2: Events and the interface state changes they cause", ["Event", "Source", "Interface state change"], [
      ["Extension starts in a project without BluePrint", "VS Code", "Status bar: Not initialized. Hub shows only Initialize. Sidebar views and the editor title button are hidden."],
      ["ARCH.md generated by the wizard", "Extension", "Wizard moves to Architecture ready. Sidebar views and the editor title button appear; the status bar becomes Idle; an open Hub switches to its dashboard."],
      ["New file(s) created", "Workspace", "One notification per batch of files (\"New file detected — review architectural impact?\" with Review and Skip)."],
      ["Review requested", "Developer", "Compliance Review opens on Checking; status bar shows Checking."],
      ["Review finished", "Extension", "Panel shows Results, Clean, No changes (with the reason) or Error. Status bar shows OK (back to Idle after 5 seconds) or Violation."],
      ["Item resolved in the review", "Developer", "The card is replaced by its outcome; the footer counts the items still open. When every violation is handled the status bar returns to Idle."],
      ["Status bar Violation clicked", "Developer", "The open review is brought to the front; if it was closed, the review runs again."],
      ["Decision saved by a Developer", "Developer", "The ADR appears under Pending approval (\"waiting for an Architect\"); the pending count appears in the status bar and the Hub banner."],
      ["Pending decision approved", "Architect", "The ADR moves to Accepted; ARCH.md is updated and the viewer highlights the changed section; the pending count drops."],
      ["Wizard answer analysed", "Extension", "The wizard shows a follow-up question (with the earlier answer above it), a draft ADR, or the next topic."],
      ["Pre-check finished", "Extension", "Pre-Check shows the result: concerns, a suggested revision and the ADRs to attach, or that no conflicts were found."],
      ["ADR Browser filtered", "Developer", "The list narrows; a banner shows the filter and a Clear filter button appears in the view title."],
      ["Files changed on disk (`git pull`, edited roles.json)", "Workspace", "Sidebar, pending count, role, initialized state and open panels refresh within about a second."],
      ["User's role becomes Developer", "roles.json", "Approve, Reject, Revert and Regenerate are hidden or disabled; pending ADRs read \"waiting for an Architect\"."],
      ["Audit entry written", "Extension", "The sidebar Audit Trail and an open Audit Trail panel show the new entry."],
    ], [2.6, 1.3, 5.5]),
    B.p("Figures 6.2 and 6.3 show how these events move the two longest workflows from state to state. The states of the status bar item are shown in Figure 5.5."),
    ...B.figure("6-2-wizard-states.png", "Figure 6.2: State diagram of the Setup Wizard"),
    ...B.figure("6-3-panel-states.png", "Figure 6.3: State diagrams of (a) the Compliance Review panel and (b) the Pre-Check panel"),

    // ── 6.3 ───────────────────────────────────────────────────────────────────
    B.h2("6.3 Interface States as Seen by the User"),
    B.p("The following figures show each interface state as the developer sees it, in VS Code's default light theme. The panel images were produced from the extension's own panel pages, driven by the same messages the extension sends, with data from a sample project: Campus Eats, a cafeteria-ordering web application with a React frontend, an Express API, PostgreSQL and Stripe. The status bar and sidebar are native VS Code elements and are shown as reconstructions."),

    B.h3("6.3.1 Status Bar and Sidebar"),
    B.p("The status bar item is always visible and summarises BluePrint's state (Figure 6.4). The sidebar (Figure 6.5) lists the decisions, with pending approvals first and Approve and Reject buttons for Architects, and the latest activity from the audit log."),
    ...B.figure("6-statusbar.png", "Figure 6.4: The status bar item in each state (reconstruction)", { widthIn: 6.0 }),
    ...B.figure("6-sidebar.png", "Figure 6.5: The BluePrint sidebar: ADR Browser and Audit Trail (reconstruction)", { widthIn: 4.0 }),

    B.h3("6.3.2 Hub"),
    B.p("Before setup the Hub offers a single action, Initialize. Afterwards it shows who the user is, a banner when decisions wait for approval, the four main tasks and links to the less frequent ones (Figure 6.6)."),
    ...B.figureRow([
      { file: "6-hub-uninitialized.png", label: "(a) Before initialization" },
      { file: "6-hub.png", label: "(b) After initialization" },
    ], "Figure 6.6: The Hub"),

    B.h3("6.3.3 Setup Wizard"),
    B.p("The wizard takes the developer from an empty project to an ARCH.md and the first ADRs. The API key is checked with one request before it is saved; the team-and-roles step appears only when the project has no roles file yet (Figure 6.7). The constraint questions follow: a follow-up repeats the earlier answer, and a single draft ADR based on both answers is offered for editing (Figure 6.8)."),
    ...B.figureRow([
      { file: "6-wizard-provider.png", label: "(a) LLM provider and API key" },
      { file: "6-wizard-roles.png", label: "(b) Team and roles" },
    ], "Figure 6.7: Setup Wizard, first steps"),
    ...B.figureRow([
      { file: "6-wizard-followup.png", label: "(a) A follow-up question" },
      { file: "6-wizard-draft.png", label: "(b) The draft ADR from both answers" },
    ], "Figure 6.8: Setup Wizard, constraint questions"),

    B.h3("6.3.4 Compliance Review"),
    B.p("Figures 6.9 and 6.10 show one review of the sample project's uncommitted changes. A violation (orders written to MongoDB despite the PostgreSQL decision) is resolved by updating the architecture or modifying the code. The new React application is recognised as the planned Frontend and can be marked implemented without an ADR. A standalone notifications module is a new component, and a hello-world script is listed as checked with its reason."),
    ...B.figure("6-compliance-results-1.png", "Figure 6.9: Compliance Review results: violation and planned component", { widthIn: 5.6 }),
    ...B.figure("6-compliance-results-2.png", "Figure 6.10: Compliance Review results (continued): new component and checked files", { widthIn: 5.6 }),
    B.p("When nothing needs attention the panel says so and still lists the files it checked; when it finds no changes it explains why, for example that the folder is ignored by an enclosing git repository (Figure 6.11)."),
    ...B.figureStack([
      { file: "6-compliance-clean.png", label: "(a) No violations or new components" },
      { file: "6-compliance-nodiff.png", label: "(b) No changes found, with the reason" },
    ], "Figure 6.11: Compliance Review outcomes without items", { widthIn: 5.0 }),

    B.h3("6.3.5 Pre-Check and Add Decision"),
    B.p("The Pre-Check panel checks a prompt for an AI coding assistant before any code is written. In Figure 6.12 the prompt asks for a MongoDB collection; the panel cites ADR-0001, suggests a revised prompt, and offers to copy the prompt together with the relevant ADRs. Add Decision (Figure 6.13) turns a plain-language decision into an editable ADR and suggests the existing decision it replaces."),
    ...B.figure("6-precheck-result.png", "Figure 6.12: Pre-Check result for a conflicting prompt", { widthIn: 5.0 }),
    ...B.figure("6-decision-draft.png", "Figure 6.13: Add Decision with a suggested replacement", { widthIn: 5.0 }),

    B.h3("6.3.6 ARCH.md Viewer, Audit Trail and Team & Roles"),
    B.p("The ARCH.md Viewer (Figure 6.14) renders the architecture and highlights the sections changed by recent decisions, with the reason for each change; the Components table shows which components are planned and which are implemented. The Audit Trail (Figure 6.15) records every review, decision and change, searchable and filterable. Team & Roles (Figure 6.16) shows the user's role and lets Architects edit the team."),
    ...B.figure("6-arch-viewer.png", "Figure 6.14: ARCH.md Viewer with recent changes highlighted", { widthIn: 5.6 }),
    ...B.figure("6-audit-trail.png", "Figure 6.15: Audit Trail panel, Activity tab", { widthIn: 5.6 }),
    ...B.figure("6-roles.png", "Figure 6.16: Team & Roles panel", { widthIn: 4.4 }),
  ];
}
