import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

export abstract class AbstractCsvParser<T> {
  public async parseCsv(csvFileContent: string): Promise<T[]> {
    const records: T[] = [];
    const errors: string[] = [];

    const parser = parse(csvFileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return new Promise((resolve, reject) => {
      parser.on('readable', () => {
        let row: Record<string, string>;

        while ((row = parser.read()) !== null) {
          try {
            const result = this.parseRow(row);

            if (result) {
              records.push(result);
            }
          } catch (err) {
            errors.push((err as Error).message);
          }
        }
      });

      parser.on('error', (err) => {
        reject(new BadRequestException('CSV parse error: ' + err.message));
      });

      parser.on('end', () => {
        if (errors.length > 0) {
          reject(
            new BadRequestException(
              'CSV validation failed:\n' + errors.join('\n'),
            ),
          );
        } else {
          resolve(records);
        }
      });

      Readable.from(csvFileContent).pipe(parser);
    });
  }

  protected abstract parseRow(row: Record<string, string>): T | null;
}
