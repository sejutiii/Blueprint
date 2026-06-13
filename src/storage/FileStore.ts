import * as vscode from "vscode";
import { ArchBlueprint } from "../types";
import { renderArchMd } from "../prompts/archPrompts";

export class FileStore {
  constructor(private readonly root: vscode.Uri) {}

  static fromWorkspace(): FileStore | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { return null; }
    return new FileStore(folders[0].uri);
  }

  private uri(...segments: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ...segments);
  }

  private async ensureDir(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch {
      // already exists
    }
  }

  async writeArchBlueprint(blueprint: ArchBlueprint, systemName?: string): Promise<void> {
    await this.ensureDir(this.uri("docs"));
    await this.ensureDir(this.uri(".blueprint"));

    await vscode.workspace.fs.writeFile(
      this.uri("docs", "ARCH.md"),
      Buffer.from(renderArchMd(blueprint, systemName), "utf-8")
    );
    await vscode.workspace.fs.writeFile(
      this.uri(".blueprint", "arch.json"),
      Buffer.from(JSON.stringify(blueprint, null, 2), "utf-8")
    );
  }

  async readArchBlueprint(): Promise<ArchBlueprint | null> {
    try {
      const raw = await vscode.workspace.fs.readFile(this.uri(".blueprint", "arch.json"));
      return JSON.parse(Buffer.from(raw).toString("utf-8")) as ArchBlueprint;
    } catch {
      return null;
    }
  }

  async isInitialized(): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.uri(".blueprint", "arch.json"));
      return true;
    } catch {
      return false;
    }
  }

  getArchMdUri(): vscode.Uri {
    return this.uri("docs", "ARCH.md");
  }
}
