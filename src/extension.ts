import * as vscode from "vscode";
import { BlueprintPanel } from "./ui/BlueprintPanel";
import { AdrTreeProvider } from "./ui/AdrTreeProvider";
import { AuditTrailTreeProvider } from "./ui/AuditTrailTreeProvider";
import { StatusBarManager } from "./ui/StatusBarManager";
import { LLMClient, Provider, PROVIDER_LABELS } from "./llm/LLMClient";
import { FileStore } from "./storage/FileStore";
import { AdrStore } from "./storage/AdrStore";
import { ArchitectureAgent } from "./agents/ArchitectureAgent";
import { ConstraintElicitationAgent } from "./agents/ConstraintElicitationAgent";
import { ComplianceAgent } from "./agents/ComplianceAgent";
import { DiffSummarizer } from "./agents/DiffSummarizer";
import { RetrievalAgent } from "./agents/RetrievalAgent";
import { ConstraintDraft } from "./prompts/constraintPrompts";
import { adrFilename } from "./prompts/adrPrompts";
import { AdrStatus, ViolationDetail, ExtensionDetail, ADR, ArchBlueprint, DiffSummary } from "./types";
import { PreCheckAgent } from "./agents/PreCheckAgent";

let statusBar: StatusBarManager;
let adrTreeProvider: AdrTreeProvider;
let auditTrailProvider: AuditTrailTreeProvider;

export function activate(context: vscode.ExtensionContext): void {
  adrTreeProvider    = new AdrTreeProvider();
  auditTrailProvider = new AuditTrailTreeProvider();
  statusBar          = new StatusBarManager();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("blueprint.adrBrowser", adrTreeProvider),
    vscode.window.registerTreeDataProvider("blueprint.auditTrail", auditTrailProvider),
    statusBar
  );

  checkInitialized().catch(console.error);

  context.subscriptions.push(
    vscode.commands.registerCommand("blueprint.init", () =>
      handleInit(context).catch((err) =>
        vscode.window.showErrorMessage(`BluePrint: ${String(err)}`)
      )
    ),

    vscode.commands.registerCommand("blueprint.openHub", () =>
      handleHub(context).catch((err) =>
        vscode.window.showErrorMessage(`BluePrint: ${String(err)}`)
      )
    ),

    vscode.commands.registerCommand("blueprint.reviewChange", () =>
      handleReviewChange(context).catch((err) =>
        vscode.window.showErrorMessage(`BluePrint: ${String(err)}`)
      )
    ),

    vscode.commands.registerCommand("blueprint.preCheck", () =>
      handlePreCheck(context).catch((err) =>
        vscode.window.showErrorMessage(`BluePrint: ${String(err)}`)
      )
    ),

    vscode.commands.registerCommand("blueprint.viewArch", () => openArchMd()),

    vscode.commands.registerCommand("blueprint.openAdrBrowser", () =>
      vscode.commands.executeCommand("workbench.view.extension.blueprint-explorer")
    ),

    vscode.commands.registerCommand("blueprint.viewAuditTrail", () =>
      handleViewAuditTrail(context).catch((err) =>
        vscode.window.showErrorMessage(`BluePrint: ${String(err)}`)
      )
    ),

    vscode.commands.registerCommand("blueprint.openAdr", async (adr: ADR) => {
      await openAdrFile(adr);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles((event) => {
      vscode.commands.executeCommand<boolean>("blueprint.initialized").then((initialized) => {
        if (!initialized) { return; }
        const names = event.files.map((f) => f.fsPath).join(", ");
        vscode.window
          .showInformationMessage(
            "BluePrint: New file detected — review architectural impact?",
            { detail: names },
            "Review",
            "Skip"
          )
          .then((choice) => {
            if (choice === "Review") { handleReviewChange(context).catch(console.error); }
          });
      });
    })
  );
}

// Refresh both sidebar tree views from the current ADR store
async function refreshProviders(): Promise<void> {
  const adrStore = AdrStore.fromWorkspace();
  const adrs     = adrStore ? await adrStore.getAll() : [];
  adrTreeProvider.refresh(adrs);
  auditTrailProvider.refresh(adrs);
}

async function checkInitialized(): Promise<void> {
  const store = FileStore.fromWorkspace();
  if (store && await store.isInitialized()) {
    await vscode.commands.executeCommand("setContext", "blueprint.initialized", true);
    statusBar.setIdle();
    await refreshProviders();
  } else {
    statusBar.setUninitialized();
  }
}

function sendNextQuestion(
  panel: import("./ui/BlueprintPanel").BlueprintPanel,
  agent: ConstraintElicitationAgent,
  index: number
): void {
  const questions = agent.getQuestions();
  const q = questions[index];
  panel.postMessage({
    command:     "showQuestion",
    question:    q.question,
    placeholder: q.placeholder,
    index,
    total:       questions.length,
  });
}

async function handleInit(context: vscode.ExtensionContext): Promise<void> {
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
  let questionIndex = 0;
  let totalSaved    = 0;

  panel.setMessageHandler(async (message) => {
    switch (message.command) {

      case "saveProvider": {
        await LLMClient.saveToSecrets(
          context.secrets,
          message.provider as Provider,
          message.apiKey as string
        );
        break;
      }

      case "useDefault": {
        const applied = await LLMClient.useDefault(context.secrets);
        if (!applied) {
          panel.postMessage({ command: "error", message: "No default API key is configured." });
        }
        break;
      }

      case "generate": {
        const llm = await LLMClient.fromSecrets(context.secrets);
        if (!llm) {
          panel.postMessage({ command: "error", message: "No LLM provider configured. Go back to step 1." });
          return;
        }
        const store = FileStore.fromWorkspace();
        if (!store) {
          panel.postMessage({ command: "error", message: "No workspace folder is open. Please open a project folder first." });
          return;
        }
        try {
          panel.postMessage({ command: "generating" });
          const blueprint = await new ArchitectureAgent(llm).generate(message.systemDescription as string);
          await store.writeArchBlueprint(blueprint, message.systemName as string);
          await vscode.commands.executeCommand("setContext", "blueprint.initialized", true);
          statusBar.setOk();
          await refreshProviders();
          panel.postMessage({ command: "success", blueprint });
        } catch (err) {
          panel.postMessage({ command: "error", message: String(err) });
        }
        break;
      }

      case "startConstraints": {
        const llm = await LLMClient.fromSecrets(context.secrets);
        if (!llm) { panel.postMessage({ command: "error", message: "No LLM provider configured." }); return; }
        constraintAgent = new ConstraintElicitationAgent(llm);
        questionIndex   = 0;
        totalSaved      = 0;
        sendNextQuestion(panel, constraintAgent, questionIndex);
        break;
      }

      case "submitAnswer": {
        if (!constraintAgent) { return; }
        const questions = constraintAgent.getQuestions();
        const question  = questions[questionIndex];
        panel.postMessage({ command: "analyzing" });
        try {
          const result = await constraintAgent.analyzeAnswer(question, message.answer as string);
          if (result.hasConstraint && result.draft) {
            panel.postMessage({
              command: "showDraft",
              draft:   result.draft,
              index:   questionIndex,
              total:   questions.length,
            });
          } else {
            questionIndex += 1;
            if (questionIndex < questions.length) {
              sendNextQuestion(panel, constraintAgent, questionIndex);
            } else {
              panel.postMessage({ command: "elicitationComplete", totalSaved });
            }
          }
        } catch (err) {
          panel.postMessage({ command: "error", message: String(err) });
        }
        break;
      }

      case "skipQuestion": {
        if (!constraintAgent) { return; }
        questionIndex += 1;
        const qs = constraintAgent.getQuestions();
        if (questionIndex < qs.length) {
          sendNextQuestion(panel, constraintAgent, questionIndex);
        } else {
          panel.postMessage({ command: "elicitationComplete", totalSaved });
        }
        break;
      }

      case "saveDraft": {
        const adrStore = AdrStore.fromWorkspace();
        if (!adrStore) { return; }
        const draft = message.draft as ConstraintDraft;
        const saved = await adrStore.create({
          title:        draft.title,
          status:       "accepted" as AdrStatus,
          context:      draft.context,
          decision:     draft.decision,
          consequences: draft.consequences,
        });
        totalSaved += 1;
        await refreshProviders();

        questionIndex += 1;
        if (constraintAgent && questionIndex < constraintAgent.getQuestions().length) {
          sendNextQuestion(panel, constraintAgent, questionIndex);
        } else {
          panel.postMessage({ command: "elicitationComplete", totalSaved });
        }
        void saved;
        break;
      }

      case "discardDraft": {
        if (!constraintAgent) { return; }
        questionIndex += 1;
        const qs2 = constraintAgent.getQuestions();
        if (questionIndex < qs2.length) {
          sendNextQuestion(panel, constraintAgent, questionIndex);
        } else {
          panel.postMessage({ command: "elicitationComplete", totalSaved });
        }
        break;
      }

      case "viewArch": {
        await openArchMd();
        break;
      }
    }
  });
}

// Shared: sets up saveDecision and confirmExtension handlers on the compliance panel
function setCompliancePanelHandler(panel: BlueprintPanel, context: vscode.ExtensionContext): void {
  panel.setMessageHandler(async (message) => {
    switch (message.command) {

      case "saveDecision": {
        const adrStore = AdrStore.fromWorkspace();
        if (!adrStore) { return; }

        const resolution = message.resolution as string;
        const reasoning  = message.reasoning  as string;
        const violations = (message.violations ?? []) as ViolationDetail[];

        const violationContext = violations.length
          ? violations.map((v) => `[${v.severity.toUpperCase()}] ${v.constraintId}: ${v.description}`).join("\n")
          : "Architectural concern detected during compliance check.";

        const adr = await adrStore.create({
          title:        `Compliance Decision: ${(violations[0]?.description ?? "violation").slice(0, 60)}`,
          status:       "accepted" as AdrStatus,
          context:      `Compliance check detected:\n${violationContext}`,
          decision:     resolution === "update-arch"
            ? `Update Architecture: ${reasoning}`
            : `Modify Code: ${reasoning}`,
          consequences: resolution === "update-arch"
            ? "ARCH.md should be updated to reflect this approved direction change."
            : "The generated code should be revised to conform to the existing constraint.",
        });

        await refreshProviders();
        panel.postMessage({ command: "saved", adrId: adr.id });
        break;
      }

      case "confirmExtension": {
        const store    = FileStore.fromWorkspace();
        const adrStore = AdrStore.fromWorkspace();
        if (!store || !adrStore) { return; }

        const blueprint = await store.readArchBlueprint();
        if (!blueprint) { return; }

        const ext       = message.extension as ExtensionDetail;
        const reasoning = (message.reasoning as string | undefined) ?? "";

        blueprint.components.push({
          name:           ext.name,
          responsibility: ext.responsibility,
          ...(ext.technology ? { technology: ext.technology } : {}),
        });
        blueprint.lastUpdated = new Date().toISOString();
        await store.writeArchBlueprint(blueprint);

        const adr = await adrStore.create({
          title:        `Extension: Add ${ext.name} component`,
          status:       "accepted" as AdrStatus,
          context:      ext.rationale,
          decision:     reasoning
            ? `Developer confirmed new component. ${reasoning}`
            : "Developer confirmed this new structural element during architectural review.",
          consequences: `ARCH.md updated to include ${ext.name} as a new component.`,
        });

        await refreshProviders();
        panel.postMessage({ command: "extensionSaved", adrId: adr.id });
        break;
      }
    }
  });
}

// Shared: gets diff + blueprint + adrs + llm. Posts error/noDiff to panel on failure, returns null.
interface ReviewContext {
  diffSummary: DiffSummary;
  blueprint:   ArchBlueprint;
  allAdrs:     ADR[];
  llm:         LLMClient;
}

async function prepareReviewContext(
  context: vscode.ExtensionContext,
  panel: BlueprintPanel
): Promise<ReviewContext | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    panel.postMessage({ command: "error", message: "No workspace folder open." });
    statusBar.setIdle();
    return null;
  }

  const summarizer = new DiffSummarizer();
  const rawDiff    = await summarizer.getDiff(workspaceFolders[0].uri.fsPath);
  if (!rawDiff.trim()) {
    panel.postMessage({ command: "noDiff" });
    statusBar.setIdle();
    return null;
  }

  const diffSummary = summarizer.summarize(rawDiff);

  const store    = FileStore.fromWorkspace();
  const adrStore = AdrStore.fromWorkspace();
  if (!store || !adrStore) {
    panel.postMessage({ command: "error", message: "Project not initialized. Run BluePrint: Initialize Project first." });
    statusBar.setIdle();
    return null;
  }

  const [blueprint, allAdrs] = await Promise.all([
    store.readArchBlueprint(),
    adrStore.getAll(),
  ]);

  if (!blueprint) {
    panel.postMessage({ command: "error", message: "ARCH.md not found. Run BluePrint: Initialize Project first." });
    statusBar.setIdle();
    return null;
  }

  const llm = await LLMClient.fromSecrets(context.secrets);
  if (!llm) {
    panel.postMessage({ command: "error", message: "No LLM provider configured. Run BluePrint: Initialize Project first." });
    statusBar.setIdle();
    return null;
  }

  return { diffSummary, blueprint, allAdrs, llm };
}

async function handleHub(context: vscode.ExtensionContext): Promise<void> {
  const panel = BlueprintPanel.show("hub", context.extensionUri);
  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {
      case "openViolations": await handleCheckViolations(context); break;
      case "openExtensions": await handleCheckExtensions(context); break;
      case "openPreCheck":   await handlePreCheck(context);        break;
    }
  });
  await panel.loadMedia("blueprintHub.html", { nonce: panel.nonce });
}

async function handleCheckViolations(context: vscode.ExtensionContext): Promise<void> {
  const panel = BlueprintPanel.show("postGeneration", context.extensionUri);
  setCompliancePanelHandler(panel, context);
  await panel.loadMedia("compliancePanel.html", { nonce: panel.nonce });
  statusBar.setChecking();
  try {
    const ctx = await prepareReviewContext(context, panel);
    if (!ctx) { return; }

    const { diffSummary, blueprint, allAdrs, llm } = ctx;
    const query        = RetrievalAgent.queryFromDiff(diffSummary);
    const relevantAdrs = await new RetrievalAgent().retrieve(query, allAdrs, blueprint, 5, AdrStore.fromWorkspace());
    const pass1        = await new ComplianceAgent(llm).check(diffSummary, blueprint, relevantAdrs);

    statusBar[pass1.violation ? "setViolationFound" : "setOk"]();
    panel.postMessage({ command: "result", result: { ...pass1, extensionDetected: false }, diffSummary });
  } catch (err) {
    panel.postMessage({ command: "error", message: String(err) });
    statusBar.setIdle();
  }
}

async function handleCheckExtensions(context: vscode.ExtensionContext): Promise<void> {
  const panel = BlueprintPanel.show("postGeneration", context.extensionUri);
  setCompliancePanelHandler(panel, context);
  await panel.loadMedia("compliancePanel.html", { nonce: panel.nonce });
  statusBar.setChecking();
  try {
    const ctx = await prepareReviewContext(context, panel);
    if (!ctx) { return; }

    const { diffSummary, blueprint, llm } = ctx;
    const pass2 = await new ComplianceAgent(llm).detectExtension(diffSummary, blueprint);

    statusBar.setOk();
    panel.postMessage({ command: "result", result: { violation: false, violations: [], adrsUsed: [], ...pass2 }, diffSummary });
  } catch (err) {
    panel.postMessage({ command: "error", message: String(err) });
    statusBar.setIdle();
  }
}

async function handleReviewChange(context: vscode.ExtensionContext): Promise<void> {
  const panel = BlueprintPanel.show("postGeneration", context.extensionUri);
  setCompliancePanelHandler(panel, context);
  await panel.loadMedia("compliancePanel.html", { nonce: panel.nonce });
  statusBar.setChecking();
  try {
    const ctx = await prepareReviewContext(context, panel);
    if (!ctx) { return; }

    const { diffSummary, blueprint, allAdrs, llm } = ctx;
    const query        = RetrievalAgent.queryFromDiff(diffSummary);
    const relevantAdrs = await new RetrievalAgent().retrieve(query, allAdrs, blueprint, 5, AdrStore.fromWorkspace());
    const agent        = new ComplianceAgent(llm);

    const [pass1, pass2] = await Promise.all([
      agent.check(diffSummary, blueprint, relevantAdrs),
      agent.detectExtension(diffSummary, blueprint),
    ]);

    statusBar[pass1.violation ? "setViolationFound" : "setOk"]();
    panel.postMessage({ command: "result", result: { ...pass1, ...pass2 }, diffSummary });
  } catch (err) {
    panel.postMessage({ command: "error", message: String(err) });
    statusBar.setIdle();
  }
}

async function handleViewAuditTrail(context: vscode.ExtensionContext): Promise<void> {
  const panel = BlueprintPanel.show("auditTrail", context.extensionUri);

  // Register handler before loadMedia so the 'ready' signal from the webview is caught
  panel.setMessageHandler(async (msg) => {
    if (msg.command === "ready") {
      const adrStore = AdrStore.fromWorkspace();
      const adrs     = adrStore ? await adrStore.getAll() : [];
      panel.postMessage({ command: "load", adrs });
    }
    if (msg.command === "openAdr") {
      await openAdrFile(msg.adr as ADR);
    }
  });

  await panel.loadMedia("auditTrail.html", { nonce: panel.nonce });
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
    vscode.window.showWarningMessage(
      "BluePrint: ARCH.md not found. Run BluePrint: Initialize Project first."
    );
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

async function handlePreCheck(context: vscode.ExtensionContext): Promise<void> {
  const store = FileStore.fromWorkspace();
  if (!store || !(await store.isInitialized())) {
    vscode.window.showWarningMessage("BluePrint: Initialize the project first before running a pre-check.");
    return;
  }

  const panel = BlueprintPanel.show("preCheck", context.extensionUri);

  panel.setMessageHandler(async (msg) => {
    switch (msg.command) {

      case "check": {
        const promptText = msg.promptText as string;
        panel.postMessage({ command: "checking" });

        try {
          const fileStore = FileStore.fromWorkspace();
          const adrStore  = AdrStore.fromWorkspace();
          if (!fileStore || !adrStore) {
            panel.postMessage({ command: "error", message: "Project store unavailable." });
            return;
          }

          const [blueprint, allAdrs] = await Promise.all([
            fileStore.readArchBlueprint(),
            adrStore.getAll(),
          ]);

          if (!blueprint) {
            panel.postMessage({ command: "error", message: "ARCH.md not found. Run BluePrint: Initialize Project first." });
            return;
          }

          const llm = await LLMClient.fromSecrets(context.secrets);
          if (!llm) {
            panel.postMessage({ command: "error", message: "No LLM provider configured. Run BluePrint: Initialize Project first." });
            return;
          }

          // Use the developer's prompt text as the retrieval query
          const relevantAdrs = await new RetrievalAgent().retrieve(promptText, allAdrs, blueprint, 5, adrStore);
          const result = await new PreCheckAgent(llm).check(promptText, blueprint, relevantAdrs);
          panel.postMessage({ command: "result", result, retrievedAdrs: relevantAdrs });

        } catch (err) {
          panel.postMessage({ command: "error", message: String(err) });
        }
        break;
      }

      case "openArch": {
        await openArchMd();
        break;
      }

      case "openAdr": {
        await openAdrFile(msg.adr as ADR);
        break;
      }
    }
  });

  await panel.loadMedia("preCheckPanel.html", { nonce: panel.nonce });
}

export function deactivate(): void {
  statusBar?.dispose();
}
