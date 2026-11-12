import { inflateRawSync } from 'node:zlib';

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const END_OF_DIRECTORY_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const STORED = 0;
const DEFLATED = 8;

export type UnpackedSize = 'fits' | 'too-large' | 'unreadable';

// Whether a zip (an .xlsx) unpacks to at most `maxBytes`, found by unpacking
// it: the sizes its directory states are the sender's word, and a megabyte of
// repeated cells unpacks to a gigabyte, which a reader that builds every row
// would hold in memory. A zip this can't read (no directory, zip64, another
// compression) is unreadable, not passed on: none of them is a spreadsheet
// people send.
export const unpackedSize = (zip: Buffer, maxBytes: number): UnpackedSize => {
  const end = endOfDirectory(zip);

  if (end === -1) {
    return 'unreadable';
  }

  const entries = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  let left = maxBytes;

  try {
    for (let entry = 0; entry < entries; entry++) {
      if (zip.readUInt32LE(at) !== DIRECTORY_ENTRY) {
        return 'unreadable';
      }

      const method = zip.readUInt16LE(at + 10);
      const packedBytes = zip.readUInt32LE(at + 20);
      const local = zip.readUInt32LE(at + 42);

      if (zip.readUInt32LE(local) !== LOCAL_ENTRY) {
        return 'unreadable';
      }

      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const packed = zip.subarray(start, start + packedBytes);

      if (method === STORED) {
        left -= packed.length;
      } else if (method === DEFLATED) {
        left -= inflatedBytes(packed, left);
      } else {
        return 'unreadable';
      }

      if (left < 0) {
        return 'too-large';
      }

      at +=
        46 +
        zip.readUInt16LE(at + 28) +
        zip.readUInt16LE(at + 30) +
        zip.readUInt16LE(at + 32);
    }
  } catch {
    // A read past the end, or data that doesn't inflate.
    return 'unreadable';
  }

  return 'fits';
};

// The bytes `packed` inflates to, or more than `max` when it passes that:
// zlib stops there instead of filling the memory.
const inflatedBytes = (packed: Buffer, max: number) => {
  try {
    return inflateRawSync(packed, { maxOutputLength: max }).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      return max + 1;
    }

    throw error;
  }
};

// The record ends the file, before a comment of up to 65535 bytes.
const endOfDirectory = (zip: Buffer) => {
  const first = Math.max(
    0,
    zip.length - END_OF_DIRECTORY_BYTES - MAX_COMMENT_BYTES,
  );

  for (let at = zip.length - END_OF_DIRECTORY_BYTES; at >= first; at--) {
    if (zip.readUInt32LE(at) === END_OF_DIRECTORY) {
      return at;
    }
  }

  return -1;
};
