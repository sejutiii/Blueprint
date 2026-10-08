import * as vscode from "vscode";
import * as path from "path";
import { BlueprintPanel } from "./ui/BlueprintPanel";
import { AdrTreeProvider } from "./ui/AdrTreeProvider";
import { AuditTrailTreeProvider } from "./ui/AuditTrailTreeProvider";
import { StatusBarManager } from "./ui/StatusBarManager";
import { LLMClient, Provider, PROVIDER_LABELS, PROVIDER_KEY_PAGES } from "./llm/LLMClient";
import { FileStore } from "./storage/FileStore";
import { AdrStore } from "./storage/AdrStore";
import { AuditLog } from "./storage/AuditLog";
import { AccessControl } from "./access/AccessControl";
import { Orchestrator, BlueprintError, ReviewMode, RolesView } from "./orchestrator/Orchestrator";
import { parseEmailList } from "./access/roles";
import { ConstraintElicitationAgent } from "./agents/ConstraintElicitationAgent";
import { ElicitationSession, WizardQuestion } from "./agents/ElicitationSession";
import { ConstraintDraft } from "./prompts/constraintPrompts";
import { adrFilename } from "./prompts/adrPrompts";
import { ViolationDetail, ExtensionDetail, ADR, AuditEntry, DiffSummary } from "./types";
import { configureTreeSitter } from "./parsing/TreeSitterExtractor";
import { configureEmbeddings } from "./embeddings/EmbeddingService";
import { splitSections, recentHighlights, RECENT_CHANGES } from "./ui/archView";
import MarkdownIt from "markdown-it";

let statusBar: StatusBarManager;
let adrTreeProvider: AdrTreeProvider;
let adrTreeView: vscode.TreeView<unknown>;
let auditTrailProvider: AuditTrailTreeProvider;
let orchestrator: Orchestrator;

// Last diff that was reviewed — decisions recorded in the compliance panel link back to these files.
let lastReviewedFiles: string[] = [];
// Mode the Compliance panel was opened with; "Re-run" and the status bar's re-run keep it.
let lastReviewMode: ReviewMode = "full";
// Violations from the last review not yet handled in the panel; at zero the status bar leaves "Violation".
let unresolvedViolations = 0;
let extensionUri: vscode.Uri;

// Read-only documents for previews (e.g. a regenerated ARCH.md shown in a diff before applying).
const PREVIEW_SCHEME = "blueprint-preview";
const previewContents = new Map<string, string>();
const previewChanged  = new vscode.EventEmitter<vscode.Uri>();

export function activate(context: vscode.ExtensionContext): void {
  const dist = path.join(context.extensionPath, "dist");
  configureTreeSitter({ runtimeDir: dist, grammarDir: path.join(dist, "grammars") });
  // Model weights live in per-extension global storage, so they survive extension updates.
  configureEmbeddings({ cacheDir: path.join(context.globalStorageUri.fsPath, "models") });
  extensionUri = context.extensionUri;

  adrTreeProvider    = new AdrTreeProvider();
  auditTrailProvider = new AuditTrailTreeProvider();
  statusBar          = new StatusBarManager();

  orchestrator = new Orchestrator(context.secrets, {
    onState: (state) => {
      switch (state) {
        case "checking":  statusBar.setChecking();       break;
        case "ok":        statusBar.setOk();             break;
        case "violation": statusBar.setViolationFound(); break;
        case "idle":      statusBar.setIdle();           break;
      }
    },
    onDataChanged: () => { void refreshProviders(); },
  });

  adrTreeView = vscode.window.createTreeView("blueprint.adrBrowser", { treeDataProvider: adrTreeProvider });
  context.subscriptions.push(
    adrTreeView,
    vscode.window.registerTreeDataProvider("blueprint.auditTrail", auditTrailProvider),
    statusBar
  );

  checkInitialized().catch(console.error);

  const register = (command: string, run: (...args: any[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(command, (...args: any[]) =>
        Promise.resolve(run(...args)).catch(reportError)
      )
    );

  register("blueprint.init",           () => handleInit(context));
  register("blueprint.openHub",        () => handleHub(context));
  register("blueprint.reviewChange",   () => handleReview(context, "full"));
  register("blueprint.showLastReview", () => handleShowLastReview(context));
  register("blueprint.preCheck",       () => handlePreCheck(context));
  register("blueprint.viewArch",       () => openArchMd());
  register("blueprint.openAdrBrowser", () => vscode.commands.executeCommand("workbench.view.extension.blueprint-explorer"));
  register("blueprint.viewAuditTrail", () => handleViewAuditTrail(context));
  register("blueprint.openAdr",        (adr: ADR) => openAdrFile(adr));
  register("blueprint.approveAdr",     (arg?: unknown) => handleApprove(arg));
  register("blueprint.rejectAdr",      (arg?: unknown) => handleReject(arg));
  register("blueprint.searchAdrs",     () => handleSearchAdrs());
  register("blueprint.filterAdrs",     () => handleFilterAdrs());
  register("blueprint.clearAdrFilter", () => setAdrFilter(""));
  register("blueprint.configureRoles", () => handleConfigureRoles());
  register("blueprint.changeProvider", () => handleChangeProvider(context));
  register("blueprint.revertArch",     () => handleRevertArch());
  register("blueprint.regenerateArch", () => handleRegenerateArch());
  register("blueprint.addDecision",    () => handleAddDecision(context));
  register("blueprint.guidedQuestions", () => handleGuidedQuestions(context));

  context.subscriptions.push(
    previewChanged,
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
      onDidChange: previewChanged.event,
      provideTextDocumentContent: (uri) => previewContents.get(uri.path) ?? "",
    })
  );

  registerAutoReview(context);

  const unsubscribe = AuditLog.onAppend(() => { void pushAuditTrail(); });
  context.subscriptions.push({ dispose: unsubscribe });

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    // Keep the ARCH.md viewer live: re-render on edits to ARCH.md or new history entries.
    watchFiles(context, folder, "{docs/ARCH.md,.blueprint/history/index.json}", () => renderArchViewer());
    // Decisions, roles and initialization can change under us (a teammate's commit after git pull,
    // or a hand edit of roles.json), so the sidebar, pending count and role are re-read from disk.
    watchFiles(context, folder, ".blueprint/{adr-index.json,roles.json,arch.json}", () => checkInitialized());
  }
}

function watchFiles(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, glob: string, onChange: () => Promise<void>): void {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, glob));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(() => { onChange().catch(console.error); }, 250);
  };
  watcher.onDidChange(changed);
  watcher.onDidCreate(changed);
  watcher.onDidDelete(changed);
  context.subscriptions.push(watcher);
}

function reportError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(err instanceof BlueprintError ? message : `BluePrint: ${message}`);
}

// New-file auto-trigger (SRS 3.1): debounced so creating several files at once asks once.
function registerAutoReview(context: vscode.ExtensionContext): void {
  const IGNORED = /(^|[\\/])(node_modules|\.git|\.blueprint|dist|out)([\\/]|$)|[\\/]docs[\\/](adr[\\/]|ARCH\.md$)/;
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles((event) => {
      if (!vscode.workspace.getConfiguration("blueprint").get<boolean>("autoReviewOnNewFile", true)) { return; }
      pending.push(...event.files.map((f) => f.fsPath).filter((p) => !IGNORED.test(p)));
      if (!pending.length) { return; }

      if (timer) { clearTimeout(timer); }
      timer = setTimeout(async () => {
        const files = [...new Set(pending)];
        pending = [];
        if (!(await orchestrator.isInitialized())) { return; }

        const names = files.map((f) => vscode.workspace.asRelativePath(f)).slice(0, 5).join(", ")
          + (files.length > 5 ? `, +${files.length - 5} more` : "");
        const choice = await vscode.window.showInformationMessage(
          "BluePrint: New file detected — review architectural impact?",
          { detail: names },
          "Review",
          "Skip"
        );
        if (choice === "Review") { await handleReview(context, "full").catch(reportError); }
      }, 1500);
    })
  );
}

// Refresh both sidebar tree views (and the pending-approval badge) from the ADR store
async function refreshProviders(): Promise<void> {
  const adrStore = AdrStore.fromWorkspace();
  const adrs     = adrStore ? await adrStore.getAll() : [];
  adrTreeProvider.refresh(adrs);
  auditTrailProvider.refresh(adrs);
  statusBar.setPending(adrs.filter((a) => a.status === "proposed").length);
  await refreshRoles();
  statusBar.refreshIdle();
  await pushAuditTrail();
}

// Safe to call any time (activation, file watcher): it never interrupts a Checking/Violation state.
async function checkInitialized(): Promise<void> {
  const initialized = await orchestrator.isInitialized();
  await vscode.commands.executeCommand("setContext", "blueprint.initialized", initialized);
  if (initialized) {
    statusBar.markInitialized();
    await refreshProviders();
  } else {
    statusBar.setUninitialized();
    await refreshRoles();
  }
  await pushHubState();
}

// ── Roles: who you are, shown everywhere a role matters ────────────────────

let currentRoles: RolesView | null = null;

async function refreshRoles(): Promise<void> {
  try {
    currentRoles = await orchestrator.roles();
  } catch {
    currentRoles = null; // no workspace folder
  }
  const isArchitect = currentRoles?.role !== "developer";
  await vscode.commands.executeCommand("setContext", "blueprint.isArchitect", isArchitect);
  adrTreeProvider.setRole(isArchitect ? "architect" : "developer");
  adrTreeView.description = currentRoles
    ? `You: ${isArchitect ? "Architect" : "Developer"}`
    : undefined;
  statusBar.setIdentity(currentRoles);
  if (currentRoles) { BlueprintPanel.get("roles")?.postMessage({ command: "render", roles: currentRoles }); }
  await renderArchViewer();
}

function sendQuestion(panel: BlueprintPanel, q: WizardQuestion): void {
  panel.postMessage({
    command:     "showQuestion",
    question:    q.question,
    placeholder: q.placeholder,
    index:       q.topicIndex,
    total:       q.topicTotal,
    isFollowUp:  q.isFollowUp,
    parent:      q.parent,
  });
}

// ── Setup wizard ────────────────────────────────────────────────────────────

async function handleInit(context: vscode.ExtensionContext): Promise<void> {
  // Initializing writes the whole ARCH.md: once roles exist, it is Architect-only (checked again on generate).
  const roles = await orchestrator.roles();
  if (roles.configured && roles.role !== "architect") {
    const who = roles.identity ? `You are ${roles.identity}, a Developer` : "BluePrint can't identify you (git user.email is unset)";
    vscode.window.showErrorMessage(
      `BluePrint: Only an Architect can initialize or re-initialize BluePrint. ${who}. Architects: ${roles.architects.join(", ")}.`
    );
    return;
  }

  if (await orchestrator.isInitialized()) {
    const choice = await vscode.window.showWarningMessage(
      "BluePrint is already initialized in this project. Re-running setup regenerates ARCH.md " +
      "(the current version is kept in .blueprint/history). Your ADRs are not deleted.",
      { modal: true },
      "Re-initialize"
    );
    if (choice !== "Re-initialize") { return; }
  }

  await openSetupPanel(context, "setup", roles);
}

// The wizard's constraint questions on their own, for an initialized project (e.g. the wizard
// was closed right after ARCH.md was generated). Open to Developers too: their ADRs wait for approval.
async function handleGuidedQuestions(context: vscode.ExtensionContext): Promise<void> {
  if (!(await orchestrator.isInitialized())) {
    vscode.window.showWarningMessage("BluePrint: Initialize the project first.");
    return;
  }
  await openSetupPanel(context, "constraints", await orchestrator.roles());
}

async function openSetupPanel(context: vscode.ExtensionContext, mode: "setup" | "constraints", roles: RolesView): Promise<void> {
  const panel = BlueprintPanel.show("setup", context.extensionUri);
  await panel.loadMedia("setupWizard.html", { nonce: panel.nonce });

  const existingClient   = await LLMClient.fromSecrets(context.secrets);
  const existingProvider = await context.secrets.get("blueprint.provider");
  const defaultConfig    = LLMClient.getDefault();
  panel.postMessage({
    command: "init",
    mode,
    keyPages: PROVIDER_KEY_PAGES,
    hasProvider: !!existingClient,
    provider: existingProvider ?? null,
    hasDefault: !!defaultConfig,
    defaultProviderLabel: defaultConfig ? PROVIDER_LABELS[defaultConfig.provider] : null,
    roles,
  });

  let constraintAgent: ConstraintElicitationAgent | null = null;
  let session: ElicitationSession | null = null;
  let totalSaved   = 0;
  let totalPending = 0;

  const showNext = (next: WizardQuestion | null) => {
    if (next) {
      sendQuestion(panel, next);
    } else {
      panel.postMessage({ command: "elicitationComplete", totalSaved, totalPending });
    }
  };

  const ELICITATION_COMMANDS = new Set(["startConstraints", "submitAnswer", "skipQuestion", "saveDraft", "discardDraft"]);

  panel.setMessageHandler(async (message) => {
    try {
      switch (message.command) {

        case "saveProvider": {
          // The key is only stored once a real request with it has succeeded.
          const provider = message.provider as Provider;
          const apiKey   = (message.apiKey as string).trim();
          const problem  = await new LLMClient(provider, apiKey).validate();
          if (problem) {
            panel.postMessage({ command: "providerError", message: problem });
          } else {
            await LLMClient.saveToSecrets(context.secrets, provider, apiKey);
            panel.postMessage({ command: "providerSaved", provider, label: PROVIDER_LABELS[provider] });
          }
          break;
        }

        case "openKeyPage": {
          const page = PROVIDER_KEY_PAGES[message.provider as Provider];
          if (page) { await vscode.env.openExternal(vscode.Uri.parse(page.url)); }
          break;
        }

        case "useDefault":
          if (!(await LLMClient.useDefault(context.secrets))) {
            panel.postMessage({ command: "error", message: "No default API key is configured." });
          }
          break;

        case "saveRoles": {
          // "Just me" sends empty lists; the saver is always added as an Architect.
          try {
            const saved = await orchestrator.saveRoles(
              parseEmailList(String(message.architects ?? "")),
              parseEmailList(String(message.developers ?? ""))
            );
            panel.postMessage({ command: "rolesSaved", roles: saved });
          } catch (err) {
            panel.postMessage({ command: "rolesError", message: err instanceof Error ? err.message : String(err) });
          }
          break;
        }

        case "refreshRoles":
          panel.postMessage({ command: "rolesInfo", roles: await orchestrator.roles() });
          break;

        case "generate": {
          panel.postMessage({ command: "generating" });
          const blueprint = await orchestrator.generateArchitecture(
            message.systemDescription as string,
            message.systemName as string
          );
          await vscode.commands.executeCommand("setContext", "blueprint.initialized", true);
          await pushHubState();
          panel.postMessage({ command: "success", blueprint });
          break;
        }

        case "startConstraints":
          constraintAgent = await orchestrator.createConstraintAgent();
          session         = constraintAgent.startSession();
          totalSaved      = 0;
          totalPending    = 0;
          showNext(session.getCurrent());
          break;

        case "submitAnswer": {
          const current = session?.getCurrent();
          if (!constraintAgent || !session || !current) { return; }
          const answer = message.answer as string;
          panel.postMessage({ command: "analyzing" });
          const result = await constraintAgent.analyzeAnswer(current, answer);
          session.recordAnswer(answer, result.followUp);
          if (result.hasConstraint && result.draft) {
            panel.postMessage({
              command: "showDraft", draft: result.draft,
              index: current.topicIndex, total: current.topicTotal, hasFollowUp: !!result.followUp && !current.isFollowUp,
            });
          } else {
            showNext(session.advance());
          }
          break;
        }

        case "skipQuestion":
          if (session) { showNext(session.skip()); }
          break;

        case "discardDraft":
          if (session) { showNext(session.advance()); }
          break;

        case "saveDraft": {
          if (!session) { return; }
          const draft = message.draft as ConstraintDraft;
          if (!draft.title?.trim() || !draft.decision?.trim()) {
            panel.postMessage({ command: "error", stage: "draft", message: "An ADR needs at least a title and a decision." });
            return;
          }
          const { autoApproved } = await orchestrator.saveConstraintDraft(draft);
          totalSaved += 1;
          if (!autoApproved) { totalPending += 1; }
          showNext(session.advance());
          break;
        }

        case "viewArch":
          await openArchMd();
          break;
      }
    } catch (err) {
      // Errors mid-elicitation keep the user on the current question instead of restarting setup.
      panel.postMessage({
        command: "error",
        stage:   ELICITATION_COMMANDS.has(message.command as string) ? "constraints" : "setup",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// ── Add Decision ────────────────────────────────────────────────────────────

// A decision or changed requirement in the developer's words → an editable ADR draft, which may
// replace an existing decision. Roles apply as everywhere: a Developer's ADR waits for approval.
async function handleAddDecision(context: vscode.ExtensionContext): Promise<void> {
  if (!(await orchestrator.isInitialized())) {
    vscode.window.showWarningMessage("BluePrint: Initialize the project first.");
    return;
  }
  const existing = BlueprintPanel.get("decision");
  const panel = BlueprintPanel.show("decision", context.extensionUri);
  if (existing) { return; } // keep whatever is in progress there

  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {
      case "ready":
        panel.postMessage({ command: "init", roles: await orchestrator.roles() });
        break;

      case "draft":
        try {
          const { result, candidates } = await orchestrator.draftDecision(String(msg.description ?? ""));
          panel.postMessage({ command: "draft", result, candidates });
        } catch (err) {
          panel.postMessage({ command: "error", stage: "draft", message: err instanceof Error ? err.message : String(err) });
        }
        break;

      case "save":
        try {
          const supersedes = typeof msg.supersedes === "string" && msg.supersedes ? msg.supersedes : undefined;
          const { adr, autoApproved } = await orchestrator.saveDecision(msg.draft as ConstraintDraft, supersedes);
          const replaced = supersedes ? ` ADR-${supersedes} is now superseded and its constraint in ARCH.md was replaced.` : " ARCH.md lists it under Constraints.";
          panel.postMessage({
            command: "saved", adrId: adr.id, pending: !autoApproved,
            message: autoApproved
              ? `"${adr.title}" is accepted.${replaced}`
              : `"${adr.title}" is waiting for an Architect's approval. ARCH.md${supersedes ? ` and ADR-${supersedes}` : ""} will change once it is approved.`,
          });
        } catch (err) {
          panel.postMessage({ command: "error", stage: "save", message: err instanceof Error ? err.message : String(err) });
        }
        break;

      case "guided":
        await handleGuidedQuestions(context);
        break;

      case "openAdr": {
        const adr = await AdrStore.fromWorkspace()?.getById(String(msg.id));
        if (adr) { await openAdrFile(adr); }
        break;
      }
    }
  });
  await panel.loadMedia("decisionPanel.html", { nonce: panel.nonce });
}

// ── Compliance review ───────────────────────────────────────────────────────

function savedMessage(adrId: string, autoApproved: boolean, archNote: string): string {
  return autoApproved
    ? `ADR-${adrId} saved. ${archNote}`
    : `ADR-${adrId} proposed and is awaiting Architect approval. ARCH.md will be updated once it is approved.`;
}

// Each violation and each extension is resolved individually and produces its own ADR.
// Replies carry the item's kind + index so the webview can mark that card as done.
function setCompliancePanelHandler(panel: BlueprintPanel): void {
  panel.setMessageHandler(async (message) => {
    const kind  = message.command === "confirmExtension" ? "extension" : "violation";
    const index = message.index as number;
    try {
      switch (message.command) {

        case "resolveViolation": {
          const result = await orchestrator.resolveViolation(
            message.violation as ViolationDetail,
            message.resolution as "update-arch" | "modify-code",
            message.reasoning as string,
            lastReviewedFiles
          );
          // "Modify Code" counts as handled too: idle (not OK), since the fix isn't reviewed yet.
          if (--unresolvedViolations <= 0) { statusBar.clearViolation(); }
          panel.postMessage(result
            ? {
                command: "itemResolved", kind, index, adrId: result.adr.id, pending: !result.autoApproved,
                message: savedMessage(result.adr.id, result.autoApproved, "ARCH.md has been updated."),
              }
            : {
                command: "itemResolved", kind, index, modifyCode: true,
                message: "No ADR recorded. Revise the code, then re-run the review.",
              });
          break;
        }

        case "confirmExtension": {
          const result = await orchestrator.confirmExtension(
            message.extension as ExtensionDetail,
            (message.reasoning as string | undefined) ?? "",
            lastReviewedFiles
          );
          panel.postMessage({
            command: "itemResolved", kind, index, adrId: result.adr.id, pending: !result.autoApproved,
            message: savedMessage(result.adr.id, result.autoApproved, "ARCH.md now lists the new component."),
          });
          break;
        }

        case "rerun":
          panel.postMessage({ command: "checking" });
          await runReview(panel, lastReviewMode);
          break;
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (message.command === "rerun") {
        panel.postMessage({ command: "error", message: text });
      } else {
        panel.postMessage({ command: "itemError", kind, index, message: text });
      }
    }
  });
}

async function runReview(panel: BlueprintPanel, mode: ReviewMode): Promise<void> {
  try {
    const outcome = await orchestrator.review(mode);
    if (outcome.kind === "noDiff") {
      panel.postMessage({ command: "noDiff" });
      return;
    }
    // Files an ADR links back to; deleted ones can't be opened, so they're left out.
    const summary = outcome.diffSummary as DiffSummary;
    lastReviewedFiles = summary.changedFiles.filter((f) => !summary.deletedFiles.includes(f));
    unresolvedViolations = outcome.result.violations.length;
    panel.postMessage({ command: "result", result: outcome.result, diffSummary: outcome.diffSummary });
  } catch (err) {
    panel.postMessage({ command: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

async function handleReview(context: vscode.ExtensionContext, mode: ReviewMode): Promise<void> {
  lastReviewMode = mode;
  const panel = BlueprintPanel.show("postGeneration", context.extensionUri);
  setCompliancePanelHandler(panel);
  await panel.loadMedia("compliancePanel.html", { nonce: panel.nonce });
  await runReview(panel, mode);
}

// Status bar "Violation": bring back the review that found it; only a closed panel costs a new review.
async function handleShowLastReview(context: vscode.ExtensionContext): Promise<void> {
  if (BlueprintPanel.get("postGeneration")) {
    BlueprintPanel.show("postGeneration", context.extensionUri);
    return;
  }
  await handleReview(context, lastReviewMode);
}

async function handleHub(context: vscode.ExtensionContext): Promise<void> {
  const panel = BlueprintPanel.show("hub", context.extensionUri);
  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {
      case "ready":          await pushHubState();                                         break;
      case "init":           await handleInit(context).catch(reportError);                 break;
      case "openViolations": await handleReview(context, "violations").catch(reportError); break;
      case "openExtensions": await handleReview(context, "extensions").catch(reportError); break;
      case "openPreCheck":   await handlePreCheck(context).catch(reportError);              break;
      case "openAddDecision": await handleAddDecision(context).catch(reportError);        break;
    }
  });
  await panel.loadMedia("blueprintHub.html", { nonce: panel.nonce });
}

// Before init the Hub offers only "Initialize"; it switches over live once setup finishes.
async function pushHubState(): Promise<void> {
  BlueprintPanel.get("hub")?.postMessage({ command: "state", initialized: await orchestrator.isInitialized() });
}

// ── Audit trail ─────────────────────────────────────────────────────────────

// Newest first (T52); embeddings stripped — the webview never needs them.
async function auditTrailData(): Promise<{ adrs: Omit<ADR, "embedding">[]; entries: AuditEntry[] }> {
  const adrStore = AdrStore.fromWorkspace();
  const auditLog = AuditLog.fromWorkspace();
  const [adrs, entries] = await Promise.all([
    adrStore ? adrStore.getAll() : Promise.resolve([] as ADR[]),
    auditLog ? auditLog.getAll() : Promise.resolve([] as AuditEntry[]),
  ]);
  const newestFirst = <T extends { timestamp: string }>(a: T, b: T) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  return {
    adrs:    adrs.map(({ embedding: _omit, ...rest }) => rest).sort(newestFirst),
    entries: [...entries].sort(newestFirst),
  };
}

// Live refresh: re-send data to the audit trail panel if it is open.
let auditTrailReady = false;
async function pushAuditTrail(): Promise<void> {
  const panel = BlueprintPanel.get("auditTrail");
  if (!panel || !auditTrailReady) { return; }
  panel.postMessage({ command: "load", ...(await auditTrailData()) });
}

async function handleViewAuditTrail(context: vscode.ExtensionContext): Promise<void> {
  const existing = BlueprintPanel.get("auditTrail");
  const panel = BlueprintPanel.show("auditTrail", context.extensionUri);
  if (existing) { await pushAuditTrail(); return; } // already loaded: just reveal + refresh (T50)

  auditTrailReady = false; // a closed panel leaves the registry, so pushAuditTrail skips it

  // Register handler before loadMedia so the 'ready' signal from the webview is caught (T53)
  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {
      case "ready":
        auditTrailReady = true;
        panel.postMessage({ command: "load", ...(await auditTrailData()) });
        break;
      case "openAdr":
        await openAdrFile(msg.adr as ADR);
        break;
      case "openFile":
        await openWorkspaceFile(msg.path as string);
        break;
    }
  });

  await panel.loadMedia("auditTrail.html", { nonce: panel.nonce });
}

// ── ARCH.md / ADR files ─────────────────────────────────────────────────────

async function openWorkspaceFile(relativePath: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length || !relativePath) { return; }
  const uri = vscode.Uri.joinPath(folders[0].uri, relativePath);
  try {
    await vscode.workspace.fs.stat(uri);
    await vscode.window.showTextDocument(uri, { preview: true });
  } catch {
    vscode.window.showWarningMessage(`BluePrint: ${relativePath} no longer exists in the workspace.`);
  }
}

// ARCH.md viewer (SRS 3.1): rendered document with recently touched sections highlighted.
const markdown = new MarkdownIt({ html: false, linkify: true }); // raw HTML in ARCH.md is escaped

async function openArchMd(): Promise<void> {
  const store = FileStore.fromWorkspace();
  if (!store) {
    vscode.window.showWarningMessage("BluePrint: No workspace folder open.");
    return;
  }
  if (!(await store.readArchMarkdown())) {
    vscode.window.showWarningMessage("BluePrint: ARCH.md not found. Run BluePrint: Initialize Project first.");
    return;
  }

  const existing = BlueprintPanel.get("archViewer");
  const panel = BlueprintPanel.show("archViewer", extensionUri);
  if (existing) { await renderArchViewer(); return; }

  panel.setMessageHandler(async (msg) => {
    try {
      switch (msg.command) {
        case "ready":      await renderArchViewer(); break;
        case "openSource": await vscode.window.showTextDocument(store.getArchMdUri()); break;
        case "revert":     await handleRevertArch(); break;
        case "regenerate": await handleRegenerateArch(); break;
        case "openLink":   await openLink(msg.href as string); break;
      }
    } catch (err) {
      reportError(err);
    }
  });
  await panel.loadMedia("archViewer.html", { nonce: panel.nonce });
}

async function renderArchViewer(): Promise<void> {
  const panel = BlueprintPanel.get("archViewer");
  const store = FileStore.fromWorkspace();
  if (!panel || !store) { return; }

  const [md, history] = await Promise.all([store.readArchMarkdown(), store.getHistory()]);
  if (!md) {
    panel.postMessage({ command: "render", missing: true, sections: [], historyCount: history.length });
    return;
  }
  const sections   = splitSections(md);
  const headings   = sections.flatMap((s) => (s.heading ? [s.heading] : []));
  const highlights = recentHighlights(history, headings);
  panel.postMessage({
    command: "render",
    recentLimit: RECENT_CHANGES,
    historyCount: history.length,
    isArchitect: currentRoles?.role !== "developer",
    sections: sections.map((s) => ({
      heading:   s.heading,
      html:      markdown.render(s.markdown),
      highlight: s.heading ? highlights.get(s.heading.toLowerCase()) : undefined,
    })),
  });
}

async function openLink(href: string): Promise<void> {
  if (!href) { return; }
  if (/^https?:\/\//i.test(href)) {
    await vscode.env.openExternal(vscode.Uri.parse(href));
    return;
  }
  if (href.startsWith("#")) { return; }
  // Relative links in docs/ARCH.md resolve against docs/.
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { return; }
  const target = vscode.Uri.joinPath(folders[0].uri, "docs", href.split("#")[0]);
  try {
    await vscode.workspace.fs.stat(target);
    await vscode.window.showTextDocument(target, { preview: true });
  } catch {
    vscode.window.showWarningMessage(`BluePrint: link target not found: ${href}`);
  }
}

async function openAdrFile(adr: ADR): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { return; }
  const uri = vscode.Uri.joinPath(folders[0].uri, "docs", "adr", adrFilename(adr));
  try {
    await vscode.workspace.fs.stat(uri);
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    vscode.window.showWarningMessage(`BluePrint: ADR file not found: ${adrFilename(adr)}`);
  }
}

// ── Pre-check ───────────────────────────────────────────────────────────────

async function handlePreCheck(context: vscode.ExtensionContext): Promise<void> {
  if (!(await orchestrator.isInitialized())) {
    vscode.window.showWarningMessage("BluePrint: Initialize the project first before running a pre-check.");
    return;
  }

  const panel = BlueprintPanel.show("preCheck", context.extensionUri);

  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {
      case "check": {
        panel.postMessage({ command: "checking" });
        try {
          const { result, adrs } = await orchestrator.preCheck(msg.promptText as string);
          panel.postMessage({ command: "result", result, adrs });
        } catch (err) {
          panel.postMessage({ command: "error", message: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case "copyWithContext": {
        try {
          const text = await orchestrator.promptWithContext(msg.promptText as string, (msg.adrIds ?? []) as string[]);
          await vscode.env.clipboard.writeText(text);
          panel.postMessage({ command: "copied", adrCount: ((msg.adrIds ?? []) as string[]).length });
        } catch (err) {
          panel.postMessage({ command: "copyFailed", message: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case "openArch": await openArchMd(); break;
      case "openAdr":  await openAdrFile(msg.adr as ADR); break;
    }
  });

  await panel.loadMedia("preCheckPanel.html", { nonce: panel.nonce });
}

// ── Approval queue, search, roles, history ──────────────────────────────────

async function pickAdr(adrs: ADR[], placeHolder: string): Promise<ADR | undefined> {
  const picked = await vscode.window.showQuickPick(
    adrs.map((a) => ({ label: `ADR-${a.id}: ${a.title}`, description: a.status, detail: a.proposedBy ? `Proposed by ${a.proposedBy}` : undefined, adr: a })),
    { placeHolder, matchOnDescription: true, matchOnDetail: true }
  );
  return picked?.adr;
}

async function resolveTargetAdr(arg: unknown): Promise<ADR | undefined> {
  const fromItem = (arg as { adr?: ADR } | undefined)?.adr ?? (arg as ADR | undefined);
  if (fromItem && typeof fromItem === "object" && "id" in fromItem) { return fromItem as ADR; }

  const adrs    = (await AdrStore.fromWorkspace()?.getAll()) ?? [];
  const pending = adrs.filter((a) => a.status === "proposed");
  if (!pending.length) {
    vscode.window.showInformationMessage("BluePrint: No decisions are awaiting approval.");
    return undefined;
  }
  return pickAdr(pending, "Choose a pending decision");
}

// The menus already hide these from Developers; the check here covers keybindings and stale menus,
// and runs before asking for a note so nobody types one for nothing.
async function handleApprove(arg: unknown): Promise<void> {
  await orchestrator.requireApprover();
  const adr = await resolveTargetAdr(arg);
  if (!adr) { return; }
  const note = await vscode.window.showInputBox({ prompt: `Approve ADR-${adr.id}: ${adr.title}`, placeHolder: "Optional note for the proposer" });
  if (note === undefined) { return; } // dismissed
  await orchestrator.approve(adr.id, note);
  vscode.window.showInformationMessage(`BluePrint: ADR-${adr.id} approved. ARCH.md updated.`);
}

async function handleReject(arg: unknown): Promise<void> {
  await orchestrator.requireApprover();
  const adr = await resolveTargetAdr(arg);
  if (!adr) { return; }
  const note = await vscode.window.showInputBox({
    prompt: `Reject ADR-${adr.id}: ${adr.title}`,
    placeHolder: "Your reasoning (required) — it is attached to the ADR for the proposer",
    validateInput: (v) => (v.trim() ? undefined : "A rejection needs your reasoning."),
  });
  if (note === undefined) { return; }
  await orchestrator.reject(adr.id, note);
  vscode.window.showInformationMessage(`BluePrint: ADR-${adr.id} rejected.`);
}

async function handleSearchAdrs(): Promise<void> {
  const adrs = (await AdrStore.fromWorkspace()?.getAll()) ?? [];
  if (!adrs.length) {
    vscode.window.showInformationMessage("BluePrint: No ADRs recorded yet.");
    return;
  }
  const adr = await pickAdr(adrs, "Search ADRs by title, status, author…");
  if (adr) { await openAdrFile(adr); }
}

async function handleFilterAdrs(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: "Filter the ADR Browser (leave empty to clear)",
    value: adrTreeProvider.getFilter(),
  });
  if (query !== undefined) { await setAdrFilter(query); }
}

// The context key shows the "Clear filter" button in the ADR Browser title only while filtering.
async function setAdrFilter(query: string): Promise<void> {
  adrTreeProvider.setFilter(query.trim());
  await vscode.commands.executeCommand("setContext", "blueprint.adrFilterActive", !!query.trim());
}

// Provider and key live in this machine's SecretStorage, not the repo, so anyone may change them
// and nothing is audited. As in the wizard, a key is saved only after one request with it worked.
async function handleChangeProvider(context: vscode.ExtensionContext): Promise<void> {
  const current = await context.secrets.get("blueprint.provider");
  const providers = Object.keys(PROVIDER_LABELS) as Provider[];
  const picked = await vscode.window.showQuickPick(
    providers.map((p) => ({
      label:       PROVIDER_LABELS[p],
      description: p === current ? "current" : PROVIDER_KEY_PAGES[p].free ? "free tier" : "paid",
      detail:      `Model: ${LLMClient.modelFor(p)}`,
      provider:    p,
    })),
    { placeHolder: "Choose the LLM provider BluePrint should use", title: "BluePrint: Change LLM Provider / API Key" }
  );
  if (!picked) { return; }
  const { provider } = picked;
  const label = PROVIDER_LABELS[provider];

  const input = vscode.window.createInputBox();
  const keyPage: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("link-external"), tooltip: `Get a ${label} API key` };
  input.title    = `BluePrint: ${label} API key`;
  input.prompt   = `Paste your ${label} API key. It is checked with one small request, then stored in VS Code's secret storage.`;
  input.password = true;
  input.ignoreFocusOut = true;
  input.buttons  = [keyPage];

  const saved = await new Promise<boolean>((resolve) => {
    let closed = false; // Escape during validation must not save the key afterwards
    input.onDidTriggerButton(() => { void vscode.env.openExternal(vscode.Uri.parse(PROVIDER_KEY_PAGES[provider].url)); });
    input.onDidChangeValue(() => { input.validationMessage = undefined; });
    input.onDidAccept(async () => {
      const apiKey = input.value.trim();
      if (!apiKey) { input.validationMessage = "Paste a key first."; return; }
      input.busy = true;
      input.enabled = false;
      const problem = await new LLMClient(provider, apiKey).validate();
      input.busy = false;
      input.enabled = true;
      if (closed) { return; }
      if (problem) { input.validationMessage = problem; return; }
      await LLMClient.saveToSecrets(context.secrets, provider, apiKey);
      resolve(true);
      input.hide();
    });
    input.onDidHide(() => { closed = true; resolve(false); input.dispose(); });
    input.show();
  });

  if (saved) {
    vscode.window.showInformationMessage(`BluePrint: Now using ${label} (${LLMClient.modelFor(provider)}).`);
  }
}

async function handleConfigureRoles(): Promise<void> {
  const access = AccessControl.fromWorkspace();
  if (!access) {
    vscode.window.showWarningMessage("BluePrint: No workspace folder open.");
    return;
  }
  const existing = BlueprintPanel.get("roles");
  const panel = BlueprintPanel.show("roles", extensionUri);
  if (existing) { panel.postMessage({ command: "render", roles: await orchestrator.roles() }); return; }

  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {
      case "ready":
      case "refresh":
        panel.postMessage({ command: "render", roles: await orchestrator.roles() });
        break;
      case "save":
        try {
          const roles = await orchestrator.saveRoles(
            parseEmailList(String(msg.architects ?? "")),
            parseEmailList(String(msg.developers ?? ""))
          );
          panel.postMessage({ command: "saved", roles });
        } catch (err) {
          panel.postMessage({ command: "error", message: err instanceof Error ? err.message : String(err) });
        }
        break;
      case "openJson":
        // Hand-editing stays possible (and is the only way to hand the Architect role over entirely).
        await vscode.window.showTextDocument(await access.ensureManifest());
        break;
    }
  });
  await panel.loadMedia("rolesPanel.html", { nonce: panel.nonce });
}

async function handleRevertArch(): Promise<void> {
  const store = FileStore.fromWorkspace();
  if (!store) { return; }
  await orchestrator.requireReverter();
  const history = (await store.getHistory()).slice().reverse();
  if (!history.length) {
    vscode.window.showInformationMessage("BluePrint: ARCH.md has no earlier versions yet.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    history.map((h) => ({
      label: h.reason,
      description: new Date(h.timestamp).toLocaleString(),
      detail: h.sections.length ? `Changed: ${h.sections.join(", ")}` : undefined,
      entry: h,
    })),
    { placeHolder: "Restore ARCH.md to the version from before this change" }
  );
  if (!picked) { return; }

  const folders = vscode.workspace.workspaceFolders!;
  const snapshotUri = vscode.Uri.joinPath(folders[0].uri, ".blueprint", "history", `${picked.entry.id}.md`);
  await vscode.commands.executeCommand("vscode.diff", snapshotUri, store.getArchMdUri(), `ARCH.md: version before "${picked.entry.reason}" ↔ current`);

  const confirm = await vscode.window.showWarningMessage(
    "Restore this version of ARCH.md? The current version is saved to history first, so this can be undone.",
    { modal: true },
    "Restore"
  );
  if (confirm !== "Restore") { return; }
  await orchestrator.revertArch(picked.entry.id, picked.entry.reason);
  vscode.window.showInformationMessage("BluePrint: ARCH.md restored.");
}

// Architect-only (enforced in the orchestrator). Nothing is written until the developer has
// seen the diff and confirmed; the previous version goes to history, so Revert can undo it.
async function handleRegenerateArch(): Promise<void> {
  const store = FileStore.fromWorkspace();
  if (!store || !(await orchestrator.isInitialized())) {
    vscode.window.showWarningMessage("BluePrint: Initialize the project first.");
    return;
  }

  const proposal = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "BluePrint: Analyzing the codebase to regenerate ARCH.md…" },
    () => orchestrator.proposeRegeneration()
  );

  const previewUri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: "/ARCH.regenerated.md" });
  previewContents.set(previewUri.path, proposal.markdown);
  previewChanged.fire(previewUri);
  await vscode.commands.executeCommand("vscode.diff", store.getArchMdUri(), previewUri, "ARCH.md: current ↔ regenerated from codebase");

  const choice = await vscode.window.showInformationMessage(
    "Apply the regenerated ARCH.md? It replaces the whole document, including manual edits. " +
    "Existing constraints are kept, and the current version is saved to history so you can revert.",
    { modal: true },
    "Apply"
  );
  if (choice !== "Apply") { return; }

  await orchestrator.applyRegeneration(proposal.blueprint);
  previewContents.delete(previewUri.path);
  vscode.window.showInformationMessage("BluePrint: ARCH.md regenerated. Use \"Revert ARCH.md\" to undo.");
}

export function deactivate(): void {
  statusBar?.dispose();
}
