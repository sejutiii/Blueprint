import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { Role, RolesManifest, ROLES_MANIFEST_PATH, parseRolesManifest, roleFor } from "./roles";

const execAsync = promisify(exec);

export interface Actor {
  identity: string | null; // git user.email, null if git is unavailable or unset
  role: Role;
}

export class AccessControl {
  constructor(private readonly root: vscode.Uri) {}

  static fromWorkspace(): AccessControl | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.length ? new AccessControl(folders[0].uri) : null;
  }

  /** Identity comes from `git config user.email` for the workspace. */
  async resolveIdentity(): Promise<string | null> {
    try {
      const { stdout } = await execAsync("git config user.email", { cwd: this.root.fsPath });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async readManifest(): Promise<RolesManifest | null> {
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, ...ROLES_MANIFEST_PATH));
      return parseRolesManifest(Buffer.from(raw).toString("utf-8"));
    } catch {
      return null;
    }
  }

  async resolveActor(): Promise<Actor> {
    const [identity, manifest] = await Promise.all([this.resolveIdentity(), this.readManifest()]);
    return { identity, role: roleFor(identity, manifest) };
  }

  /** Write a starter manifest (the current user as the only Architect) if none exists. */
  async ensureManifest(): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(this.root, ...ROLES_MANIFEST_PATH);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      const identity = (await this.resolveIdentity()) ?? "architect@example.com";
      const manifest: RolesManifest = { architects: [identity], developers: [] };
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, ".blueprint"));
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));
    }
    return uri;
  }
}
