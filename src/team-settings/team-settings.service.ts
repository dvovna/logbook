import { Injectable } from '@nestjs/common';
import TeamSettingsRepository from 'src/team-settings/team-settings.repository';
import ITeamSettingsViewModel from 'src/team-settings/types/team-settings.interface';

export const DEFAULT_VACATION_DAYS = 28;
export const DEFAULT_BONUS_DAYS = 3;

type UpdateParams = {
  vacation_days?: number;
  bonus_days?: number;
};
type FindParams = Pick<ITeamSettingsViewModel, 'team_id'>;

@Injectable()
export default class TeamSettingsService {
  public constructor(
    private readonly teamSettingsRepository: TeamSettingsRepository,
  ) {}

  public async getByTeamId(
    teamId: string,
  ): Promise<ITeamSettingsViewModel | null> {
    return this.teamSettingsRepository.findOne({ team_id: teamId });
  }

  public async update(
    findParams: FindParams,
    updateParams: UpdateParams,
    updatedBy: string,
  ) {
    return this.teamSettingsRepository.update(
      {
        ...findParams,
      },
      {
        ...updateParams,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
    );
  }

  public async createDefaultSettings(teamId: string, userId: string) {
    await this.teamSettingsRepository.create({
      team_id: teamId,
      vacation_days: DEFAULT_VACATION_DAYS,
      bonus_days: DEFAULT_BONUS_DAYS,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userId,
      updated_by: userId,
    });
  }
}
