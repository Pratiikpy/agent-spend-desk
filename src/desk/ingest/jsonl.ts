import { createReadStream } from "node:fs";

export interface JsonlLine {
  text: string;
  /** Byte offset of the first byte of the line. */
  startOffset: number;
  /** Byte offset just after the line, including its newline when present. */
  endOffset: number;
  /** False only for a final line that has no trailing newline. */
  terminated: boolean;
}

const NEWLINE = 0x0a;

/**
 * Read a JSONL file line by line from a byte offset, splitting on raw 0x0A bytes so that
 * multi-byte UTF-8 characters are never cut and offsets are exact. A log that is still being
 * written can end in a partial line; that line is yielded with `terminated: false` so the
 * caller can decide to leave it for the next run instead of counting it as bad data.
 */
export async function* readJsonlLines(path: string, startOffset = 0): AsyncGenerator<JsonlLine> {
  if (!Number.isSafeInteger(startOffset) || startOffset < 0) throw new RangeError("startOffset must be a non-negative integer");
  const stream = createReadStream(path, { start: startOffset, highWaterMark: 1 << 20 });
  let carry: Buffer = Buffer.alloc(0);
  let carryStart = startOffset;
  for await (const chunk of stream) {
    const buf: Buffer = carry.length === 0 ? (chunk as Buffer) : Buffer.concat([carry, chunk as Buffer]);
    let from = 0;
    for (;;) {
      const nl = buf.indexOf(NEWLINE, from);
      if (nl === -1) break;
      const end = carryStart + nl + 1;
      yield { text: buf.toString("utf8", from, nl).replace(/\r$/, ""), startOffset: carryStart + from, endOffset: end, terminated: true };
      from = nl + 1;
    }
    carry = buf.subarray(from);
    carryStart += from;
  }
  if (carry.length > 0) {
    yield { text: carry.toString("utf8").replace(/\r$/, ""), startOffset: carryStart, endOffset: carryStart + carry.length, terminated: false };
  }
}
