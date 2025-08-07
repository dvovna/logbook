import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  Tables,
} from 'src/common/repositories/base.repository';
import { IVacationViewModel } from 'src/vacations/types/vacation.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';

@Injectable()
export class VacationsRepository extends BaseRepository<
  Tables['vacations'],
  IVacationViewModel
> {
  protected readonly tableName = 'vacations';

  protected mapToViewModel = (row: Tables['vacations']['Row']) => {
    return {
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      type: row.type as VacationType,
      status: row.status as VacationStatus,
      days: row.days,
      comment: row.comment || null,
      teamId: row.team_id,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvedByHr: row.approved_by_hr,
      approvedByManager: row.approved_by_manager,
      updatedBy: row.updated_by,
      createdBy: row.created_by,
    };
  };
}
