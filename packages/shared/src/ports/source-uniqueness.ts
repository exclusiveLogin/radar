/** Вклад провайдера в dedup: extension-поля + lookup до insert. */
export interface ISourceUniquenessContributor {
  readonly sourceKind: string;
  extensionUniqueKeys: readonly string[];
  hashExtensionSlice(extension: unknown): Record<string, unknown>;
  findDuplicateByExtension?(query: unknown): Promise<string | null>;
}

/** Registry sourceKind → contributor для composable uniqueness. */
export class SourceUniquenessRegistry {
  private readonly contributors = new Map<string, ISourceUniquenessContributor>();

  register(contributor: ISourceUniquenessContributor): void {
    this.contributors.set(contributor.sourceKind, contributor);
  }

  get(sourceKind: string): ISourceUniquenessContributor | undefined {
    return this.contributors.get(sourceKind);
  }
}
