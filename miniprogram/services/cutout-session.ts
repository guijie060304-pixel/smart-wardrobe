interface CutoutSession { sourcePath: string; accept: (path: string) => boolean }
const sessions = new Map<string, CutoutSession>();
let sequence = 0;
export function createCutoutSession(sourcePath: string, accept: (path: string) => boolean): string {
  const id = `cutout_${Date.now().toString(36)}_${++sequence}`;
  sessions.set(id, { sourcePath, accept }); return id;
}
export function getCutoutSource(id: string): string | undefined { return sessions.get(id)?.sourcePath; }
export function closeCutoutSession(id: string): void { sessions.delete(id); }
export function deliverCutoutResult(id: string, path: string): boolean {
  const session = sessions.get(id); if (!session || !path) return false;
  const accepted = session.accept(path); if (accepted) sessions.delete(id); return accepted;
}
