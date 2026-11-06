import { Module } from '@nestjs/common';
import { ClientsRepository } from '@modules/clients/repositories/clients.repository';
import ClientsService from '@modules/clients/services/clients.service';

@Module({
  providers: [ClientsRepository, ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
