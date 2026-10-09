// Minimal stand-in for the `vscode` module, aliased in vitest.config.ts. It implements only
// what the storage/access/service layers use, backed by the real file system, so those layers
// are tested against actual files in a temp directory.
import * as fs from "fs/promises";
import * as nodePath from "path";

export class Uri {
  private constructor(readonly fsPath: string, readonly scheme = "file", readonly path = fsPath) {}

  static file(p: string): Uri {
    return new Uri(nodePath.resolve(p));
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(nodePath.join(base.fsPath, ...segments));
  }

  static parse(value: string): Uri {
    return new Uri(value, value.split(":")[0]);
  }

  toString(): string {
    return this.fsPath;
  }
}

class FileSystemError extends Error {}

export const workspace = {
  workspaceFolders: undefined as { uri: Uri; name: string; index: number }[] | undefined,

  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      try {
        return await fs.readFile(uri.fsPath);
      } catch (err) {
        throw new FileSystemError(String(err));
      }
    },
    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      await fs.mkdir(nodePath.dirname(uri.fsPath), { recursive: true });
      await fs.writeFile(uri.fsPath, content);
    },
    async createDirectory(uri: Uri): Promise<void> {
      await fs.mkdir(uri.fsPath, { recursive: true });
    },
    async stat(uri: Uri): Promise<{ type: number; size: number }> {
      try {
        const s = await fs.stat(uri.fsPath);
        return { type: s.isDirectory() ? 2 : 1, size: s.size };
      } catch (err) {
        throw new FileSystemError(String(err));
      }
    },
    async delete(uri: Uri): Promise<void> {
      try {
        await fs.rm(uri.fsPath, { recursive: true });
      } catch (err) {
        throw new FileSystemError(String(err));
      }
    },
  },

  getConfiguration(section?: string) {
    return {
      get: <T>(key: string, fallback: T): T => {
        const full = section ? `${section}.${key}` : key;
        return full in configValues ? (configValues[full] as T) : fallback;
      },
    };
  },
};

const configValues: Record<string, unknown> = {};

/** Set a setting as `getConfiguration` returns it, e.g. `__setConfig("blueprint.retrieval.topK", 2)`; undefined clears it. */
export function __setConfig(key: string, value: unknown): void {
  if (value === undefined) { delete configValues[key]; } else { configValues[key] = value; }
}

/** Point `workspace.workspaceFolders` at a directory (tests call this in beforeEach). */
export function __setWorkspaceRoot(dir: string | null): void {
  workspace.workspaceFolders = dir ? [{ uri: Uri.file(dir), name: "test", index: 0 }] : undefined;
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };
  fire(e: T): void { this.listeners.forEach((l) => l(e)); }
  dispose(): void { this.listeners = []; }
}

export class ThemeIcon { constructor(readonly id: string) {} }
export class ThemeColor { constructor(readonly id: string) {} }
export class MarkdownString { constructor(readonly value = "") {} }
export class TreeItem {
  description?: string;
  tooltip?: unknown;
  contextValue?: string;
  iconPath?: unknown;
  command?: unknown;
  constructor(readonly label: string, readonly collapsibleState?: number) {}
}
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }

export enum StatusBarAlignment { Left = 1, Right = 2 }
export interface FakeStatusBarItem {
  text: string; tooltip?: string; command?: string; backgroundColor?: ThemeColor;
  show(): void; dispose(): void;
}
export const window = {
  createStatusBarItem: (): FakeStatusBarItem => ({ text: "", show: () => {}, dispose: () => {} }),
};
