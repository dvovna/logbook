export default class EntityHasDependenciesError extends Error {
  public constructor(entityName: string, dependencyName = '') {
    super(
      `This ${entityName} has dependencies ${dependencyName ? `(${dependencyName})` : ''} and cannot be deleted.`,
    );

    this.name = 'EntityHasDependenciesError';
  }
}
