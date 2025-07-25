import { Module } from '@nestjs/common';
import { VacationService } from 'src/vacation/vacation.service';

@Module({
  providers: [VacationService],
  exports: [VacationService],
})
export class VacationModule {}
