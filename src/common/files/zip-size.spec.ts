import { deflateRawSync } from 'node:zlib';
import { Workbook } from 'exceljs';
import { unpackedSize } from '@common/files/zip-size';

const MB = 1024 * 1024;

// A zip of one entry, as its packed bytes and the size its directory states.
const zipOf = (
  packed: Buffer,
  { method = 8, statedSize = 0 }: { method?: number; statedSize?: number } = {},
) => {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(statedSize, 22);
  local.writeUInt16LE(name.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(method, 10);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(statedSize, 24);
  entry.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(entry.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + packed.length, 16);

  return Buffer.concat([local, name, packed, entry, name, end]);
};

describe('unpackedSize', () => {
  it('fits a workbook people send', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('People').addRows([
      ['Name', 'Email'],
      ['Ada', 'ada@x.test'],
    ]);
    const content = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(unpackedSize(content, 10 * MB)).toBe('fits');
  });

  // 20 MB of one repeated cell pack into a few kilobytes, and the directory
  // says they are small.
  it('finds a small file that unpacks to more, whatever size it states', () => {
    const packed = deflateRawSync(Buffer.alloc(20 * MB, '<c><v>1</v></c>'));

    expect(packed.length).toBeLessThan(MB);
    expect(unpackedSize(zipOf(packed, { statedSize: 100 }), 10 * MB)).toBe(
      'too-large',
    );
    expect(unpackedSize(zipOf(packed), 20 * MB)).toBe('fits');
  });

  it('counts an entry stored as it is', () => {
    const stored = zipOf(Buffer.alloc(2 * MB), { method: 0 });

    expect(unpackedSize(stored, MB)).toBe('too-large');
    expect(unpackedSize(stored, 2 * MB)).toBe('fits');
  });

  it.each([
    ['no zip', Buffer.from('PK not a workbook')],
    ['another compression', zipOf(Buffer.alloc(10), { method: 12 })],
    ['data that does not inflate', zipOf(Buffer.from('not deflated'))],
    ['a directory cut short', zipOf(Buffer.alloc(10)).subarray(40)],
  ])('reads %s as unreadable', (_what, content) => {
    expect(unpackedSize(content, 10 * MB)).toBe('unreadable');
  });
});
