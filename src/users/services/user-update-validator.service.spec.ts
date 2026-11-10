import { UserUpdateValidatorService } from 'src/users/services/user-update-validator.service';
import { UsersRepository } from 'src/users/repositories/users.repository';
import TeamsService from 'src/teams/services/teams.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';

const soleAdmin: IUserViewModel = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.Admin,
  is_active: true,
  team_id: null,
  slack_team_id: 'slack-team-1',
  slack_id: 'U_ADMIN',
  created_at: '2026-01-01T00:00:00Z',
};

describe('UserUpdateValidatorService', () => {
  let usersRepository: { count: jest.Mock };
  let validator: UserUpdateValidatorService;

  beforeEach(() => {
    usersRepository = { count: jest.fn().mockResolvedValue(1) };

    validator = new UserUpdateValidatorService(
      usersRepository as unknown as UsersRepository,
      {} as TeamsService,
      {} as VacationPoliciesService,
    );
  });

  it('lets the only admin change fields other than role and status', async () => {
    await expect(validator.validate(soleAdmin, {})).resolves.toBeUndefined();
    await expect(
      validator.validate(soleAdmin, { role: UserRole.Admin }),
    ).resolves.toBeUndefined();
  });

  it('keeps at least one active admin when the role changes', async () => {
    await expect(
      validator.validate(soleAdmin, { role: UserRole.Member }),
    ).rejects.toThrow(ValidationError);
  });

  it('keeps at least one active admin when the admin is deactivated', async () => {
    await expect(
      validator.validate(soleAdmin, { isActive: false }),
    ).rejects.toThrow(ValidationError);
  });

  it('allows demoting an admin when another admin remains', async () => {
    usersRepository.count.mockResolvedValue(2);

    await expect(
      validator.validate(soleAdmin, { role: UserRole.Member }),
    ).resolves.toBeUndefined();
  });
});
