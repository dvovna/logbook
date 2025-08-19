import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class VacationPoliciesCacheService implements OnModuleInit {
  private readonly logger = new Logger(VacationPoliciesCacheService.name);

  private cache: Map<string, IVacationPolicyViewModel> = new Map();
  private isInitialized = false;

  public constructor(
    private readonly policiesRepository: VacationPoliciesRepository,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!this.isReady()) {
      await this.init();
    }
  }

  public async init() {
    const policies = await this.policiesRepository.findMany({});

    await Promise.all(
      policies.map(
        async (policy) =>
          await this.cacheManager.set(this.getCacheKey(policy.id), policy),
      ),
    );

    this.isInitialized = true;

    this.logger.log(
      `Vacation policies cache initialized with ${policies.length} items`,
    );
  }

  public getById(id: string): Promise<IVacationPolicyViewModel | undefined> {
    return this.cacheManager.get(this.getCacheKey(id));
  }

  public async refresh() {
    this.cache.clear();
    await this.init();
  }

  public isReady(): boolean {
    return this.isInitialized;
  }

  private getCacheKey(id: string): string {
    return `vacation-policies.cache-${id}`;
  }
}
