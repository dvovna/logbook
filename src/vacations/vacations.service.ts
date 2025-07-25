import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationsRepository } from 'src/vacations/vacations.repository';
import getDaysBetweenDates from 'src/common/utils/getDaysBetweenDates';
import { IVacationViewModel } from 'src/vacations/types/vacation.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';

interface IVacationCreateParams {
  startDate: Date;
  endDate: Date;
  type: VacationType;
  status: VacationStatus;
}

interface IVacationFindParams {
  userId?: string;
  startDate?: string;
  status?: VacationStatus;
  type?: VacationType;
}

interface IVacationsService {
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

  public async findMany(params: IVacationFindParams) {
    return await this.vacationsRepository.findMany({
      ...(params.userId ? { user_id: params.userId } : {}),
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
      days: getDaysBetweenDates(vacation.startDate, vacation.endDate),
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
