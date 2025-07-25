import {
  BaseRepository,
  TableName,
  Tables,
} from 'src/common/repositories/base.repository';
import { Injectable } from '@nestjs/common';
import ITeamSettingsViewModel from 'src/team-settings/types/team-settings.interface';

@Injectable()
export default class TeamSettingsRepository extends BaseRepository<
  Tables['team_settings'],
  ITeamSettingsViewModel
> {
  protected tableName: TableName = 'team_settings';

  protected mapToViewModel = (data: Tables['team_settings']['Row']) => {
    return {
      id: data.id,
      team_id: data.team_id,
      vacation_days: data.vacation_days,
      bonus_days: data.bonus_days,
      created_at: data.created_at,
      created_by: data.created_by,
      updated_at: data.updated_at,
      updated_by: data.updated_by,
    };
  };
}
