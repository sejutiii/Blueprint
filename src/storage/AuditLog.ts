import * as vscode from "vscode";
import { AuditEntry } from "../types";

// Append-only record of every architectural event (SRS 2.3 decision audit trail).
// Lives in .blueprint/audit-log.json so it is version-controlled with the repo.
let queue: Promise<unknown> = Promise.resolve();

export class AuditLog {
  constructor(private readonly root: vscode.Uri) {}

  static fromWorkspace(): AuditLog | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.length ? new AuditLog(folders[0].uri) : null;
  }

  private get file(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".blueprint", "audit-log.json");
  }

  async getAll(): Promise<AuditEntry[]> {
    try {
      const raw = await vscode.workspace.fs.readFile(this.file);
      const parsed = JSON.parse(Buffer.from(raw).toString("utf-8"));
      return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
    } catch {
      return [];
    }
  }

  append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const run = queue.then(async () => {
      const entries = await this.getAll();
      const full: AuditEntry = {
        ...entry,
        id:        `E${String(entries.length + 1).padStart(5, "0")}`,
        timestamp: new Date().toISOString(),
      };
      entries.push(full);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, ".blueprint"));
      await vscode.workspace.fs.writeFile(this.file, Buffer.from(JSON.stringify(entries, null, 2), "utf-8"));
      return full;
    });
    queue = run.catch(() => undefined);
    return run;
  }
}
