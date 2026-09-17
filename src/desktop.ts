type StudioBindings = Record<string, (...args: any[]) => Promise<any>>;

declare global {
  interface Window {
    go?: { main?: { Studio?: StudioBindings } };
  }
}

export function studio(): StudioBindings {
  const bindings = window.go?.main?.Studio;
  if (!bindings) throw new Error("桌面服务不可用。请使用 Wails 启动 Ecom Visual Studio。");
  return bindings;
}

export async function uploadFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return studio().Upload(file.name, file.type, Array.from(bytes));
}
