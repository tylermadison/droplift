// PROTOTYPE — minimal typing for the tiny bridge
export type Tiny = {
  api: { call: (m: string, p?: unknown) => Promise<any>; on: (e: string, fn: (d: any) => void) => () => void };
};
export const getTiny = (): Tiny | undefined => (globalThis as any).tiny;
export const report = (data: unknown) => getTiny()?.api.call('report', data).catch(() => {});
