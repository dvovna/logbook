import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationsRepository } from 'src/vacations/vacations.repository';
import getDaysBetweenDays from 'src/common/utils/get-days-between-days';
import { IVacationViewModel } from 'src/vacations/types/vacation.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';

interface IVacationCreateParams {
  userId: string;
  teamId: string;
  startDate: Date;
  endDate: Date;
  type: VacationType;
  status: VacationStatus;
  comment?: string | null;
}

interface IVacationFindParams {
  userId?: string;
  startDate?: string;
  status?: VacationStatus;
  type?: VacationType;
}

interface IVacationsService {
  create(
    createParams: IVacationCreateParams,
    user: IUserViewModel,
  ): Promise<IVacationViewModel>;
  findMany(findParams: IVacationFindParams): Promise<IVacationViewModel[]>;
  replaceUserVacations(
    userId: string,
    vacations: IVacationCreateParams[],
    replacedBy: IUserViewModel,
  ): Promise<IVacationViewModel[]>;
}

@Injectable()
export class VacationsService implements IVacationsService {
  public constructor(
    private readonly vacationsRepository: VacationsRepository,
  ) {}

  public async create(
    createParams: IVacationCreateParams,
    user: IUserViewModel,
  ) {
    const now = new Date().toISOString();
    const vacationRecord = {
      user_id: createParams.userId,
      team_id: createParams.teamId,
      start_date: createParams.startDate.toISOString(),
      end_date: createParams.endDate.toISOString(),
      days: getDaysBetweenDays(createParams.startDate, createParams.endDate),
      type: createParams.type,
      status: createParams.status,
      comment: createParams.comment || null,
      approved_by_hr: false,
      approved_by_manager: false,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      updated_by: user.id,
    };

    return await this.vacationsRepository.create(vacationRecord);
  }

  public async findMany(params: IVacationFindParams) {
    return await this.vacationsRepository.findMany({
      ...(params.userId ? { user_id: params.userId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.startDate
        ? { start_date: { value: params.startDate, operator: 'gte' } }
        : {}),
    });
  }

  public async replaceUserVacations(
    userId: string,
    vacations: IVacationCreateParams[],
    replacedBy: IUserViewModel,
  ) {
    await this.vacationsRepository.delete({
      user_id: userId,
    });

    const now = new Date().toISOString();
    const vacationRecords = vacations.map((vacation) => ({
      user_id: userId,
      start_date: vacation.startDate.toISOString(),
      end_date: vacation.endDate.toISOString(),
      days: getDaysBetweenDays(vacation.startDate, vacation.endDate),
      type: vacation.type,
      status: vacation.status,
      created_at: now,
      updated_at: now,
      created_by: replacedBy.id,
      updated_by: replacedBy.id,
    }));

    return await this.vacationsRepository.createMany(vacationRecords);
  }
}
