import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";

export type Handle = <S extends z.ZodTuple>(
  channel: string,
  args: S,
  fn: (args: z.output<S>, event: IpcMainInvokeEvent) => unknown,
) => void;

/**
 * The shared `handle(channel, schema, fn)` for IPC: calls from any page other than the app's own are
 * refused, and the arguments are validated before `fn` sees them.
 */
export function createHandle(isAppUrl: (url: string) => boolean): Handle {
  return (channel, args, fn) => {
    ipcMain.handle(channel, (event, ...raw: unknown[]) => {
      const url = event.senderFrame?.url ?? "";
      if (!isAppUrl(url)) throw new Error(`${channel} is not available to ${url || "this page"}`);
      const parsed = args.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid request to ${channel}: ${z.prettifyError(parsed.error)}`);
      return fn(parsed.data, event);
    });
  };
}
