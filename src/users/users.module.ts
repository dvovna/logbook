import { Module } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import { UsersRepository } from '@modules/users/repositories/users.repository';
import { TeamsModule } from '@modules/teams/teams.module';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { UserUpdateValidatorService } from '@modules/users/services/user-update-validator.service';

@Module({
  imports: [TeamsModule, VacationPoliciesModule],
  providers: [UsersService, UsersRepository, UserUpdateValidatorService],
  exports: [UsersService],
})
export class UsersModule {}
