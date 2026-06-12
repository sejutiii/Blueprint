import * as vscode from "vscode";
import { BlueprintPanel } from "./ui/BlueprintPanel";
import { AdrTreeProvider } from "./ui/AdrTreeProvider";
import { StatusBarManager } from "./ui/StatusBarManager";

let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext): void {
  const adrTreeProvider = new AdrTreeProvider();
  statusBar = new StatusBarManager();

  // Register sidebar tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("blueprint.adrBrowser", adrTreeProvider),
    statusBar
  );

  // Check if workspace is already initialized
  const isInitialized = isWorkspaceInitialized();
  vscode.commands.executeCommand("setContext", "blueprint.initialized", isInitialized);
  if (!isInitialized) {
    statusBar.setUninitialized();
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("blueprint.init", () =>
      handleInit(context, adrTreeProvider)
    ),

    vscode.commands.registerCommand("blueprint.reviewChange", () =>
      handleReviewChange(context)
    ),

    vscode.commands.registerCommand("blueprint.preCheck", () =>
      handlePreCheck(context)
    ),

    vscode.commands.registerCommand("blueprint.viewArch", () =>
      BlueprintPanel.show("archViewer", context.extensionUri)
    ),

    vscode.commands.registerCommand("blueprint.openAdrBrowser", () => {
      vscode.commands.executeCommand("workbench.view.extension.blueprint-explorer");
    }),

    vscode.commands.registerCommand("blueprint.viewAuditTrail", () =>
      BlueprintPanel.show("auditTrail", context.extensionUri)
    )
  );

  // Auto-trigger on new file creation
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles((event) => {
      if (!isWorkspaceInitialized()) return;
      const names = event.files.map((f) => f.fsPath).join(", ");
      vscode.window
        .showInformationMessage(
          `BluePrint: New file(s) detected — ${names}. Review architectural impact?`,
          "Review",
          "Skip"
        )
        .then((choice) => {
          if (choice === "Review") {
            handleReviewChange(context);
          }
        });
    })
  );
}

function isWorkspaceInitialized(): boolean {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) return false;
  const root = workspaceFolders[0].uri;
  const blueprintDir = vscode.Uri.joinPath(root, ".blueprint", "arch.json");
  // Synchronous check not available in VSCode API — resolved during PROJECT_INIT
  // The context key "blueprint.initialized" is the authoritative flag
  return false; // updated to true after PROJECT_INIT completes
}

function handleInit(
  context: vscode.ExtensionContext,
  adrTreeProvider: AdrTreeProvider
): void {
  BlueprintPanel.show("setup", context.extensionUri);
  // Setup wizard logic (system description collection + Constraint Elicitation Agent)
  // will be wired here in Component 3 (Constraint Elicitation Agent)
  vscode.window.showInformationMessage("BluePrint: Setup wizard opened. (Agent not yet connected)");
}

function handleReviewChange(context: vscode.ExtensionContext): void {
  BlueprintPanel.show("postGeneration", context.extensionUri);
  statusBar.setChecking();
  // Diff pipeline + Compliance Agent will be wired here in Component 4
  vscode.window.showInformationMessage("BluePrint: Compliance check triggered. (Agent not yet connected)");
  statusBar.setIdle();
}

function handlePreCheck(context: vscode.ExtensionContext): void {
  // Pre-check (Component 8) — prompt-level conflict detection
  vscode.window.showInputBox({ prompt: "Enter your prompt to pre-check against architecture" })
    .then((prompt) => {
      if (!prompt) return;
      vscode.window.showInformationMessage(`BluePrint: Pre-check for prompt received. (Agent not yet connected)`);
    });
}

export function deactivate(): void {
  statusBar?.dispose();
}
