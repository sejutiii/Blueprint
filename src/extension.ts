import * as vscode from "vscode";
import * as path from "path";
import { BlueprintPanel } from "./ui/BlueprintPanel";
import { AdrTreeProvider } from "./ui/AdrTreeProvider";
import { AuditTrailTreeProvider } from "./ui/AuditTrailTreeProvider";
import { StatusBarManager } from "./ui/StatusBarManager";
import { LLMClient, Provider, PROVIDER_LABELS } from "./llm/LLMClient";
import { FileStore } from "./storage/FileStore";
import { AdrStore } from "./storage/AdrStore";
import { AuditLog } from "./storage/AuditLog";
import { AccessControl } from "./access/AccessControl";
import { Orchestrator, BlueprintError, ReviewMode } from "./orchestrator/Orchestrator";
import { ConstraintElicitationAgent } from "./agents/ConstraintElicitationAgent";
import { ElicitationSession, WizardQuestion } from "./agents/ElicitationSession";
import { ConstraintDraft } from "./prompts/constraintPrompts";
import { adrFilename } from "./prompts/adrPrompts";
import { ViolationDetail, ExtensionDetail, ADR, AuditEntry, DiffSummary } from "./types";
import { configureGrammarDir } from "./parsing/TreeSitterExtractor";

let statusBar: StatusBarManager;
let adrTreeProvider: AdrTreeProvider;
let auditTrailProvider: AuditTrailTreeProvider;
let orchestrator: Orchestrator;

// Last diff that was reviewed — decisions recorded in the compliance panel link back to these files.
let lastReviewedFiles: string[] = [];

export function activate(context: vscode.ExtensionContext): void {
  configureGrammarDir(path.join(context.extensionPath, "node_modules", "tree-sitter-wasms", "out"));

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

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("blueprint.adrBrowser", adrTreeProvider),
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
  register("blueprint.preCheck",       () => handlePreCheck(context));
  register("blueprint.viewArch",       () => openArchMd());
  register("blueprint.openAdrBrowser", () => vscode.commands.executeCommand("workbench.view.extension.blueprint-explorer"));
  register("blueprint.viewAuditTrail", () => handleViewAuditTrail(context));
  register("blueprint.openAdr",        (adr: ADR) => openAdrFile(adr));
  register("blueprint.approveAdr",     (arg?: unknown) => handleApprove(arg));
  register("blueprint.rejectAdr",      (arg?: unknown) => handleReject(arg));
  register("blueprint.searchAdrs",     () => handleSearchAdrs());
  register("blueprint.filterAdrs",     () => handleFilterAdrs());
  register("blueprint.configureRoles", () => handleConfigureRoles());
  register("blueprint.revertArch",     () => handleRevertArch());

  registerAutoReview(context);

  const unsubscribe = AuditLog.onAppend(() => { void pushAuditTrail(); });
  context.subscriptions.push({ dispose: unsubscribe });
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
  statusBar.refreshIdle();
  await pushAuditTrail();
}

async function checkInitialized(): Promise<void> {
  if (await orchestrator.isInitialized()) {
    await vscode.commands.executeCommand("setContext", "blueprint.initialized", true);
    statusBar.setIdle();
    await refreshProviders();
  } else {
    statusBar.setUninitialized();
  }
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
  if (await orchestrator.isInitialized()) {
    const choice = await vscode.window.showWarningMessage(
      "BluePrint is already initialized in this project. Re-running setup regenerates ARCH.md " +
      "(the current version is kept in .blueprint/history). Your ADRs are not deleted.",
      { modal: true },
      "Re-initialize"
    );
    if (choice !== "Re-initialize") { return; }
  }

  const panel = BlueprintPanel.show("setup", context.extensionUri);
  await panel.loadMedia("setupWizard.html", { nonce: panel.nonce });

  const existingClient   = await LLMClient.fromSecrets(context.secrets);
  const existingProvider = await context.secrets.get("blueprint.provider");
  const defaultConfig    = LLMClient.getDefault();
  panel.postMessage({
    command: "init",
    hasProvider: !!existingClient,
    provider: existingProvider ?? null,
    hasDefault: !!defaultConfig,
    defaultProviderLabel: defaultConfig ? PROVIDER_LABELS[defaultConfig.provider] : null,
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

        case "saveProvider":
          await LLMClient.saveToSecrets(context.secrets, message.provider as Provider, message.apiKey as string);
          break;

        case "useDefault":
          if (!(await LLMClient.useDefault(context.secrets))) {
            panel.postMessage({ command: "error", message: "No default API key is configured." });
          }
          break;

        case "generate": {
          panel.postMessage({ command: "generating" });
          const blueprint = await orchestrator.generateArchitecture(
            message.systemDescription as string,
            message.systemName as string
          );
          await vscode.commands.executeCommand("setContext", "blueprint.initialized", true);
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
          await runReview(panel, "full");
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
    lastReviewedFiles = (outcome.diffSummary as DiffSummary).newFiles;
    panel.postMessage({ command: "result", result: outcome.result, diffSummary: outcome.diffSummary });
  } catch (err) {
    panel.postMessage({ command: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

async function handleReview(context: vscode.ExtensionContext, mode: ReviewMode): Promise<void> {
  const panel = BlueprintPanel.show("postGeneration", context.extensionUri);
  setCompliancePanelHandler(panel);
  await panel.loadMedia("compliancePanel.html", { nonce: panel.nonce });
  await runReview(panel, mode);
}

async function handleHub(context: vscode.ExtensionContext): Promise<void> {
  const panel = BlueprintPanel.show("hub", context.extensionUri);
  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {
      case "openViolations": await handleReview(context, "violations").catch(reportError); break;
      case "openExtensions": await handleReview(context, "extensions").catch(reportError); break;
      case "openPreCheck":   await handlePreCheck(context).catch(reportError);              break;
    }
  });
  await panel.loadMedia("blueprintHub.html", { nonce: panel.nonce });
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

async function openArchMd(): Promise<void> {
  const store = FileStore.fromWorkspace();
  if (!store) {
    vscode.window.showWarningMessage("BluePrint: No workspace folder open.");
    return;
  }
  const uri = store.getArchMdUri();
  try {
    await vscode.workspace.fs.stat(uri);
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    vscode.window.showWarningMessage("BluePrint: ARCH.md not found. Run BluePrint: Initialize Project first.");
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

async function handleApprove(arg: unknown): Promise<void> {
  const adr = await resolveTargetAdr(arg);
  if (!adr) { return; }
  const note = await vscode.window.showInputBox({ prompt: `Approve ADR-${adr.id}: ${adr.title}`, placeHolder: "Optional note for the proposer" });
  if (note === undefined) { return; } // dismissed
  await orchestrator.approve(adr.id, note);
  vscode.window.showInformationMessage(`BluePrint: ADR-${adr.id} approved. ARCH.md updated.`);
}

async function handleReject(arg: unknown): Promise<void> {
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
  if (query !== undefined) { adrTreeProvider.setFilter(query); }
}

async function handleConfigureRoles(): Promise<void> {
  const access = AccessControl.fromWorkspace();
  if (!access) {
    vscode.window.showWarningMessage("BluePrint: No workspace folder open.");
    return;
  }
  const uri = await access.ensureManifest();
  await vscode.window.showTextDocument(uri);
  vscode.window.showInformationMessage(
    "BluePrint: List Architect emails under \"architects\". Commit this file so the whole team shares it."
  );
}

async function handleRevertArch(): Promise<void> {
  const store = FileStore.fromWorkspace();
  if (!store) { return; }
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
  await store.revertTo(picked.entry.id);
  await AuditLog.fromWorkspace()?.append({
    eventType: "arch_reverted", summary: `ARCH.md reverted to the version before "${picked.entry.reason}"`,
    actor: (await AccessControl.fromWorkspace()?.resolveIdentity()) ?? undefined,
  });
  vscode.window.showInformationMessage("BluePrint: ARCH.md restored.");
}

export function deactivate(): void {
  statusBar?.dispose();
}
