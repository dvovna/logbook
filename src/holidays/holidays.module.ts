import { Module } from '@nestjs/common';
import { HolidaysRepository } from 'src/holidays/holidays.repository';
import HolidaysService from 'src/holidays/holidays.service';
import { HttpModule } from '@nestjs/axios';
import HolidayImportService from 'src/holidays/holiday-import.service';
import { CountryHolidaysProvider } from 'src/holidays/providers/country-holidays.provider';
import { CacheModule } from '@nestjs/cache-manager';
import { NagerDateClient } from 'src/holidays/clients/nager-date.client';

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
