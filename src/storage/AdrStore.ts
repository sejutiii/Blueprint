import * as vscode from "vscode";
import { ADR } from "../types";
import { renderAdrMd, adrFilename } from "../prompts/adrPrompts";

interface AdrIndex {
  nextId: number;
  adrs: ADR[];
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
      const raw = await vscode.workspace.fs.readFile(
        this.uri(".blueprint", "adr-index.json")
      );
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

  async create(draft: Omit<ADR, "id" | "timestamp" | "embedding">): Promise<ADR> {
    const index = await this.readIndex();
    const adr: ADR = {
      ...draft,
      id:        String(index.nextId).padStart(4, "0"),
      timestamp: new Date().toISOString(),
    };

    await this.ensureDir(this.uri("docs", "adr"));
    await vscode.workspace.fs.writeFile(
      this.uri("docs", "adr", adrFilename(adr)),
      Buffer.from(renderAdrMd(adr), "utf-8")
    );

    index.adrs.push(adr);
    index.nextId += 1;
    await this.writeIndex(index);

    return adr;
  }

  async getAll(): Promise<ADR[]> {
    const index = await this.readIndex();
    return index.adrs;
  }

  async getById(id: string): Promise<ADR | null> {
    const index = await this.readIndex();
    return index.adrs.find((a) => a.id === id) ?? null;
  }

  async update(id: string, changes: Partial<Omit<ADR, "id" | "timestamp">>): Promise<ADR> {
    const index = await this.readIndex();
    const i = index.adrs.findIndex((a) => a.id === id);
    if (i === -1) { throw new Error(`ADR ${id} not found`); }

    const updated: ADR = { ...index.adrs[i], ...changes };
    index.adrs[i] = updated;

    await vscode.workspace.fs.writeFile(
      this.uri("docs", "adr", adrFilename(updated)),
      Buffer.from(renderAdrMd(updated), "utf-8")
    );
    await this.writeIndex(index);

    return updated;
  }

  async storeEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.update(id, { embedding });
  }
}
