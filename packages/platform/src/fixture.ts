import type {
  FileEntry,
  FileStat,
  FileSystemPort,
  PathPort,
  RuntimePlatform,
} from "./ports";

export class FixtureFileSystem implements FileSystemPort {
  constructor(private readonly files: Readonly<Record<string, string>>) {}
  async exists(path: string): Promise<boolean> {
    return (
      path in this.files ||
      Object.keys(this.files).some((key) =>
        key.startsWith(`${path.replace(/\/$/, "")}/`),
      )
    );
  }
  async list(path: string): Promise<FileEntry[]> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const entries = new Map<string, FileEntry>();
    for (const [key, value] of Object.entries(this.files)) {
      if (!key.startsWith(prefix)) continue;
      const relative = key.slice(prefix.length);
      const slash = relative.indexOf("/");
      const name = slash < 0 ? relative : relative.slice(0, slash);
      const entryPath = `${path.replace(/\/$/, "")}/${name}`;
      if (slash < 0)
        entries.set(entryPath, {
          path: entryPath,
          name,
          isFile: true,
          isDirectory: false,
          size: new TextEncoder().encode(value).byteLength,
          modifiedAt: Date.now(),
        });
      else
        entries.set(entryPath, {
          path: entryPath,
          name,
          isFile: false,
          isDirectory: true,
          size: 0,
          modifiedAt: Date.now(),
        });
    }
    return [...entries.values()];
  }
  async stat(path: string): Promise<FileStat> {
    const value = this.files[path];
    if (value === undefined) throw new Error(`Fixture file not found: ${path}`);
    return {
      size: new TextEncoder().encode(value).byteLength,
      modifiedAt: Date.now(),
      isFile: true,
    };
  }
  async readRange(
    path: string,
    start: number,
    end?: number,
  ): Promise<ArrayBuffer> {
    const value = this.files[path] ?? "";
    const bytes = new TextEncoder().encode(value);
    return bytes.slice(start, end).buffer;
  }
}

const fixturePaths: PathPort = {
  home: async () => "/fixture",
  appData: async () => "/fixture/app-data",
  appCache: async () => "/fixture/cache",
};
export const createFixturePlatform = (
  files: Readonly<Record<string, string>>,
): RuntimePlatform => ({
  kind: "fixture",
  paths: fixturePaths,
  fs: new FixtureFileSystem(files),
});
