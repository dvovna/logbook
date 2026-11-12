import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

export abstract class AbstractCsvParser<T> {
  // Columns the header row has to have; a file without them is refused as a
  // whole instead of every row failing on its own.
  protected readonly requiredColumns: readonly string[] = [];

  public async parseCsv(csvFileContent: string): Promise<T[]> {
    const records: T[] = [];
    const errors: string[] = [];
    let headerError: string | undefined;

    const parser = parse(csvFileContent, {
      columns: (header: string[]) => {
        const missing = this.requiredColumns.filter(
          (column) => !header.includes(column),
        );

        if (missing.length) {
          headerError = this.headerErrorMessage(missing);
        }

        return header;
      },
      skip_empty_lines: true,
      trim: true,
      delimiter: ';',
    });

    return new Promise((resolve, reject) => {
      parser.on('readable', () => {
        let row: Record<string, string>;

        // eslint-disable-next-line no-cond-assign
        while ((row = parser.read()) !== null) {
          if (headerError) {
            continue;
          }

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
        if (headerError) {
          reject(new BadRequestException(headerError));
        } else if (errors.length > 0) {
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

  protected headerErrorMessage(missing: readonly string[]): string {
    return `The header row lacks: ${missing.join(', ')}.`;
  }

  protected abstract parseRow(row: Record<string, string>): T | null;
}
