import * as vscode from "vscode";
import { ArchBlueprint, ArchEffect } from "../types";
import { renderArchMd } from "../prompts/archPrompts";
import { MAX_COMPONENT_FILES, addComponentRow, addConstraint, replaceConstraint, setComponentStatus, setLastUpdated } from "./archPatch";

export interface ArchHistoryEntry {
  id: string;           // also the snapshot file stem
  timestamp: string;    // when the change that replaced this snapshot happened
  reason: string;       // human-readable description of that change
  sections: string[];   // ARCH.md sections the change touched (for viewer highlighting)
}

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

  private async readText(uri: vscode.Uri): Promise<string | null> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf-8");
    } catch {
      return null;
    }
  }

  private async writeText(uri: vscode.Uri, text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf-8"));
  }

  // ── Blueprint read/write ──────────────────────────────────────────────────

  /**
   * Full render of ARCH.md from the blueprint. Used for first-time init and for
   * explicit regeneration — it overwrites manual edits, so the previous version is
   * snapshotted first whenever one exists. Incremental changes use applyArchEffect.
   */
  async writeArchBlueprint(blueprint: ArchBlueprint, systemName?: string, reason = "ARCH.md regenerated"): Promise<void> {
    await this.ensureDir(this.uri("docs"));
    await this.ensureDir(this.uri(".blueprint"));

    if (await this.isInitialized()) {
      await this.snapshot(reason, ["Full document"]);
    }

    const name = systemName ?? (await this.readSystemName()) ?? undefined;
    await this.writeText(this.uri("docs", "ARCH.md"), renderArchMd(blueprint, name));
    await this.writeText(this.uri(".blueprint", "arch.json"), JSON.stringify(blueprint, null, 2));
  }

  async readArchBlueprint(): Promise<ArchBlueprint | null> {
    const raw = await this.readText(this.uri(".blueprint", "arch.json"));
    if (raw === null) { return null; }
    try {
      return JSON.parse(raw) as ArchBlueprint;
    } catch {
      return null;
    }
  }

  async readArchMarkdown(): Promise<string | null> {
    return this.readText(this.uri("docs", "ARCH.md"));
  }

  async readSystemName(): Promise<string | null> {
    const md = await this.readArchMarkdown();
    const m  = md?.match(/^#\s+Architecture:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  }

  /**
   * Apply an approved ADR's effect to ARCH.md as a targeted patch (manual edits elsewhere
   * in the file are preserved) and mirror it in arch.json. Snapshots the prior version first.
   * Returns the sections that changed (empty if the effect was already present).
   */
  async applyArchEffect(effect: ArchEffect, reason: string): Promise<string[]> {
    const blueprint = await this.readArchBlueprint();
    if (!blueprint) { throw new Error("Project is not initialized — no arch.json found."); }

    const currentMd = (await this.readArchMarkdown()) ?? renderArchMd(blueprint, (await this.readSystemName()) ?? undefined);

    let patched;
    if (effect.kind === "add-component") {
      patched = addComponentRow(currentMd, effect.component);
      const exists = blueprint.components.some((c) => c.name.toLowerCase() === effect.component.name.toLowerCase());
      if (!exists) { blueprint.components.push(effect.component); }
    } else if (effect.kind === "add-constraint") {
      patched = addConstraint(currentMd, effect.constraint);
      if (!blueprint.constraints.some((c) => c.toLowerCase() === effect.constraint.trim().toLowerCase())) {
        blueprint.constraints.push(effect.constraint.trim());
      }
    } else if (effect.kind === "mark-implemented") {
      const component = blueprint.components.find((c) => c.name.toLowerCase() === effect.component.trim().toLowerCase());
      if (!component) { throw new Error(`ARCH.md has no component named "${effect.component}".`); }
      component.status = "implemented";
      component.files  = [...new Set([...(component.files ?? []), ...effect.files])].slice(0, MAX_COMPONENT_FILES);
      patched = setComponentStatus(currentMd, component);
    } else {
      patched = replaceConstraint(currentMd, effect.replaces, effect.constraint);
      const next = effect.constraint.trim();
      const old  = blueprint.constraints.findIndex((c) => c.toLowerCase() === effect.replaces.trim().toLowerCase());
      if (old !== -1) { blueprint.constraints.splice(old, 1); }
      if (!blueprint.constraints.some((c) => c.toLowerCase() === next.toLowerCase())) {
        blueprint.constraints.splice(old !== -1 ? old : blueprint.constraints.length, 0, next);
      }
    }

    if (patched.touched.length === 0) { return []; }

    await this.snapshot(reason, patched.touched);
    blueprint.lastUpdated = new Date().toISOString();
    await this.writeText(this.uri("docs", "ARCH.md"), setLastUpdated(patched.markdown, blueprint.lastUpdated));
    await this.writeText(this.uri(".blueprint", "arch.json"), JSON.stringify(blueprint, null, 2));
    return patched.touched;
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

  // ── Version history (SRS 2.1) ─────────────────────────────────────────────

  async getHistory(): Promise<ArchHistoryEntry[]> {
    const raw = await this.readText(this.uri(".blueprint", "history", "index.json"));
    if (!raw) { return []; }
    try {
      return JSON.parse(raw) as ArchHistoryEntry[];
    } catch {
      return [];
    }
  }

  /** Save the *current* ARCH.md + arch.json before they are changed. */
  private async snapshot(reason: string, sections: string[]): Promise<void> {
    const md   = await this.readArchMarkdown();
    const json = await this.readText(this.uri(".blueprint", "arch.json"));
    if (md === null && json === null) { return; }

    const history = await this.getHistory();
    const now     = new Date();
    const id      = `${now.toISOString().replace(/[:.]/g, "-")}-${String(history.length + 1).padStart(4, "0")}`;

    await this.ensureDir(this.uri(".blueprint", "history"));
    if (md !== null)   { await this.writeText(this.uri(".blueprint", "history", `${id}.md`), md); }
    if (json !== null) { await this.writeText(this.uri(".blueprint", "history", `${id}.json`), json); }

    history.push({ id, timestamp: now.toISOString(), reason, sections });
    await this.writeText(this.uri(".blueprint", "history", "index.json"), JSON.stringify(history, null, 2));
  }

  /** Restore a snapshot (the current version is snapshotted first, so a revert is itself reversible). */
  async revertTo(id: string): Promise<void> {
    const md   = await this.readText(this.uri(".blueprint", "history", `${id}.md`));
    const json = await this.readText(this.uri(".blueprint", "history", `${id}.json`));
    if (md === null && json === null) { throw new Error(`History snapshot ${id} not found.`); }

    await this.snapshot(`Reverted to version ${id}`, ["Full document"]);
    if (md !== null)   { await this.writeText(this.uri("docs", "ARCH.md"), md); }
    if (json !== null) { await this.writeText(this.uri(".blueprint", "arch.json"), json); }
  }

  async readSnapshotMarkdown(id: string): Promise<string | null> {
    return this.readText(this.uri(".blueprint", "history", `${id}.md`));
  }
}
