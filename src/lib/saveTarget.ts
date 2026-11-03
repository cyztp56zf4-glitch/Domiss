/**
 * Where exports are saved: a user-chosen folder (any disk) via the File System Access API,
 * remembered across sessions in IndexedDB. Falls back to a normal browser download.
 */

type PermissionMode = { mode: "read" | "readwrite" };
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(opts: PermissionMode): Promise<PermissionState>;
  requestPermission(opts: PermissionMode): Promise<PermissionState>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

const DB = "domiss";
const STORE = "settings";
const KEY = "exportDir";

export const folderPickerSupported = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idb<FileSystemDirectoryHandle | undefined>("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker({ id: "domiss-export", mode: "readwrite" });
    await idb("readwrite", (s) => s.put(handle, KEY));
    return handle;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null; // user cancelled
    throw e;
  }
}

export async function forgetFolder(): Promise<void> {
  await idb("readwrite", (s) => s.delete(KEY));
}

/**
 * Make sure we may write to the folder. Must be called from a click handler
 * (before any long await), because the browser may show a permission prompt.
 */
export async function ensureWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as DirHandle;
  if (typeof h.queryPermission !== "function") return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

/** "video.mp4" → "video (2).mp4" if the name is taken. */
async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch {
      return candidate; // NotFoundError → free
    }
  }
  return `${stem}-${Date.now()}${ext}`;
}

export async function writeToFolder(dir: FileSystemDirectoryHandle, name: string, blob: Blob): Promise<string> {
  const finalName = await freeName(dir, name);
  const file = await dir.getFileHandle(finalName, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return finalName;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
