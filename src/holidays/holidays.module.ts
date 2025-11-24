import { Module } from '@nestjs/common';
import { HolidaysRepository } from '@modules/holidays/repositories/holidays.repository';
import HolidaysService from '@modules/holidays/services/holidays.service';
import { HttpModule } from '@nestjs/axios';
import HolidayImportService from '@modules/holidays/services/holiday-import.service';
import { CountryHolidaysProvider } from '@modules/holidays/providers/country-holidays.provider';
import { CacheModule } from '@nestjs/cache-manager';
import { NagerDateClient } from '@modules/holidays/clients/nager-date.client';

@Module({
  imports: [HttpModule, CacheModule.register()],
  providers: [
    HolidaysRepository,
    HolidaysService,
    NagerDateClient,
    CountryHolidaysProvider,
    HolidayImportService,
  ],
  exports: [HolidaysService, HolidayImportService],
})
export class HolidaysModule {}
