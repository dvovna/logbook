import { Module } from '@nestjs/common';
import { UsersService } from 'src/users/services/users.service';
import { UsersRepository } from 'src/users/repositories/users.repository';
import { TeamsModule } from 'src/teams/teams.module';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { UserUpdateValidatorService } from 'src/users/services/user-update-validator.service';

@Module({
  imports: [TeamsModule, VacationPoliciesModule],
  providers: [UsersService, UsersRepository, UserUpdateValidatorService],
  exports: [UsersService],
})
export class UsersModule {}
