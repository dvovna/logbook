import { Injectable } from '@nestjs/common';
import validator from 'validator';
import { AbstractCsvParser } from 'src/user-data-import/parsers/abstract-csv-parser';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';

export interface IUserVacationRecord {
  email: string;
  contractStartDate: Date;
  vacations: {
    startDate: Date;
    endDate: Date;
    type: VacationType;
    status: VacationStatus;
  }[];
}

@Injectable()
export default class UserVacationsCsvParser extends AbstractCsvParser<IUserVacationRecord> {
  protected parseRow(row: Record<string, string>) {
    const { email, contractStartDate, ...rest } = row;

    if (!email || !validator.isEmail(email)) {
      throw new Error(`Invalid or missing email: ${email}`);
    }

    if (!contractStartDate || !validator.isISO8601(contractStartDate)) {
      throw new Error(
        `Invalid or missing contractStartDate for user: ${email}`,
      );
    }

    const vacations: IUserVacationRecord['vacations'] = [];

    for (let i = 0; i < 100; i++) {
      const startDateKey = `vacation[${i}].startDate`;
      const endDateKey = `vacation[${i}].endDate`;
      const typeKey = `vacation[${i}].type`;
      const statusKey = `vacation[${i}].status`;

      const hasNext = !!rest[startDateKey];

      if (!hasNext) {
        break;
      }

      const startDate = this.getValueWithValidation(
        startDateKey,
        rest,
        email,
        i,
      );
      const endDate = this.getValueWithValidation(endDateKey, rest, email, i);
      const status = this.getValueWithValidation<VacationStatus>(
        statusKey,
        rest,
        email,
        i,
      );
      const type = this.getValueWithValidation<VacationType>(
        typeKey,
        rest,
        email,
        i,
      );

      if (!validator.isISO8601(startDate)) {
        throw new Error(
          `Vacation ${i + 1} for ${email} is invalid: ${startDate} is not a valid date.`,
        );
      }

      if (!validator.isISO8601(endDate)) {
        throw new Error(
          `Vacation ${i + 1} for ${email} is invalid: ${endDate} is not a valid date.`,
        );
      }

      if (!Object.values(VacationType).includes(type)) {
        throw new Error(
          `Vacation ${i + 1} for ${email} is invalid: field type should be one of ${Object.values(VacationType).join(', ')}`,
        );
      }

      if (!Object.values(VacationType).includes(type)) {
        throw new Error(
          `Vacation ${i + 1} for ${email} is invalid: field status should be one of ${Object.values(VacationStatus).join(', ')}`,
        );
      }

      vacations.push({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        type,
        status,
      });
    }

    return { email, contractStartDate: new Date(contractStartDate), vacations };
  }

  private getValueWithValidation<FieldValue = string>(
    fieldKey: string,
    data: Record<string, unknown>,
    email: string,
    vacationIndex: number,
  ) {
    const fieldValue = data[fieldKey] as FieldValue | undefined;

    if (!fieldValue) {
      throw new Error(
        `Vacation ${vacationIndex + 1} for ${email} is incomplete: ${fieldKey} is required.`,
      );
    }

    return fieldValue as FieldValue;
  }
}
