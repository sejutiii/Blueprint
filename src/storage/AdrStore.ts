import * as vscode from "vscode";
import { ADR } from "../types";
import { renderAdrMd, adrFilename } from "../prompts/adrPrompts";

interface AdrIndex {
  nextId: number;
  adrs: ADR[];
}

export type AdrDraft = Omit<ADR, "id" | "timestamp" | "embedding">;

// All index read-modify-write cycles run through one queue, so concurrent callers
// (e.g. retrieval caching embeddings while the user saves a decision) can't lose
// updates or hand out the same ID twice.
let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

export class AdrStore {
  constructor(private readonly root: vscode.Uri) {}

  static fromWorkspace(): AdrStore | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { return null; }
    return new AdrStore(folders[0].uri);
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

  private async readIndex(): Promise<AdrIndex> {
    try {
      const raw = await vscode.workspace.fs.readFile(this.uri(".blueprint", "adr-index.json"));
      return JSON.parse(Buffer.from(raw).toString("utf-8")) as AdrIndex;
    } catch {
      return { nextId: 1, adrs: [] };
    }
  }

  private async writeIndex(index: AdrIndex): Promise<void> {
    await this.ensureDir(this.uri(".blueprint"));
    await vscode.workspace.fs.writeFile(
      this.uri(".blueprint", "adr-index.json"),
      Buffer.from(JSON.stringify(index, null, 2), "utf-8")
    );
  }

  private async writeMarkdown(adr: ADR): Promise<void> {
    await this.ensureDir(this.uri("docs", "adr"));
    await vscode.workspace.fs.writeFile(
      this.uri("docs", "adr", adrFilename(adr)),
      Buffer.from(renderAdrMd(adr), "utf-8")
    );
  }

  create(draft: AdrDraft): Promise<ADR> {
    return serialized(async () => {
      const index = await this.readIndex();
      const adr: ADR = {
        ...draft,
        id:        String(index.nextId).padStart(4, "0"),
        timestamp: new Date().toISOString(),
      };

      await this.writeMarkdown(adr);
      index.adrs.push(adr);
      index.nextId += 1;
      await this.writeIndex(index);
      return adr;
    });
  }

  async getAll(): Promise<ADR[]> {
    return (await this.readIndex()).adrs;
  }

  async getById(id: string): Promise<ADR | null> {
    return (await this.getAll()).find((a) => a.id === id) ?? null;
  }

  /** Update an ADR in both the index and its markdown file (T43). A title change renames the file. */
  update(id: string, changes: Partial<Omit<ADR, "id" | "timestamp">>): Promise<ADR> {
    return serialized(async () => {
      const index = await this.readIndex();
      const i = index.adrs.findIndex((a) => a.id === id);
      if (i === -1) { throw new Error(`ADR ${id} not found`); }

      const previous = index.adrs[i];
      const updated: ADR = { ...previous, ...changes };
      index.adrs[i] = updated;

      if (adrFilename(previous) !== adrFilename(updated)) {
        try { await vscode.workspace.fs.delete(this.uri("docs", "adr", adrFilename(previous))); } catch { /* already gone */ }
      }
      await this.writeMarkdown(updated);
      await this.writeIndex(index);
      return updated;
    });
  }

  /** Cache an embedding in the index only — the markdown file doesn't contain it, so it isn't rewritten. */
  storeEmbedding(id: string, embedding: number[]): Promise<void> {
    return serialized(async () => {
      const index = await this.readIndex();
      const adr   = index.adrs.find((a) => a.id === id);
      if (!adr) { return; }
      adr.embedding = embedding;
      await this.writeIndex(index);
    });
  }
}
