import { Injectable } from '@nestjs/common';
import validator from 'validator';
import { AbstractCsvParser } from '@modules/user-data-import/parsers/abstract-csv-parser';

export interface IUserTeamRecord {
  email: string;
  team_name: string;
}

@Injectable()
export default class UserTeamMappingCsvParser extends AbstractCsvParser<IUserTeamRecord> {
  protected parseRow(row: Record<string, string>): IUserTeamRecord {
    const { email, team_name } = row;

    if (!email || !validator.isEmail(email)) {
      throw new Error(`Invalid or missing email: ${email}`);
    }

    if (!team_name || team_name.trim().length === 0) {
      throw new Error(`Invalid or missing team_name for user: ${email}`);
    }

    return {
      email: email.trim(),
      team_name: team_name.trim(),
    };
  }
}
