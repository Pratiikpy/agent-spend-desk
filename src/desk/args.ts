import { parseArgs } from "node:util";

/** A command line the person typed wrongly: shown as one plain line, never as a stack trace. */
export class UsageError extends Error {}

/** Node's own wording is long and mentions positional arguments, which is advice for a different mistake. */
function plain(message: string): string {
  const unknown = /^Unknown option '([^']+)'/.exec(message);
  if (unknown) return `unknown option '${unknown[1]}'`;
  const missing = /^Option '([^']+)' argument missing/.exec(message);
  if (missing) return `option '${missing[1]}' needs a value`;
  const first = message.split(". ")[0] ?? message;
  return first.charAt(0).toLowerCase() + first.slice(1);
}

/** `parseArgs`, with the types it gives, that throws a UsageError for a mistake in the command line and rethrows anything else. */
export const parseOrUsage = ((config?: Parameters<typeof parseArgs>[0]) => {
  try {
    return parseArgs(config);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (e instanceof Error && typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_")) throw new UsageError(plain(e.message));
    throw e;
  }
}) as unknown as typeof parseArgs;

/** The same for a program's entry point: print one line and exit with code 2. */
export const parseOrExit = ((config?: Parameters<typeof parseArgs>[0]) => {
  try {
    return parseOrUsage(config);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`desk: ${e.message}. "desk help" lists the commands.`);
    process.exit(2);
  }
}) as unknown as typeof parseArgs;
