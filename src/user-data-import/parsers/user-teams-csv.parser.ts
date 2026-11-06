import { Injectable } from '@nestjs/common';
import validator from 'validator';
import { AbstractCsvParser } from 'src/user-data-import/parsers/abstract-csv-parser';

export interface IUserTeamRecord {
  email: string;
  team: string;
}

// Rows of `user-teams.csv`: `email,team`, where team is a team name.
@Injectable()
export default class UserTeamsCsvParser extends AbstractCsvParser<IUserTeamRecord> {
  protected parseRow(row: Record<string, string>) {
    const { email, team } = row;

    if (!email || !validator.isEmail(email)) {
      throw new Error(`Invalid or missing email: ${email}`);
    }

    if (!team) {
      throw new Error(`Missing team for user: ${email}`);
    }

    return { email, team };
  }
}
