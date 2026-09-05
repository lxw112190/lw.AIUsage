export interface FileEntry { path: string; name: string; isFile: boolean; isDirectory: boolean; size: number; modifiedAt: number; }
export interface FileStat { size: number; modifiedAt: number; isFile: boolean; }
export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<FileEntry[]>;
  stat(path: string): Promise<FileStat>;
  readRange(path: string, start: number, end?: number): Promise<ArrayBuffer>;
}
export interface PathPort { home(): Promise<string>; appData(): Promise<string>; appCache(): Promise<string>; }
export interface WatchOptions { recursive?: boolean; }
export type WatchHandler = (path: string) => void;
export interface WatchHandle { close(): Promise<void>; }
export interface WatchPort { watch(path: string, options: WatchOptions, handler: WatchHandler): Promise<WatchHandle>; }
export interface RuntimePlatform { kind: "fixture" | "node-dev" | "lw-web2app"; paths: PathPort; fs: FileSystemPort; watch?: WatchPort; }
