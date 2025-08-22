export interface ISearchResult<Item> {
  items: Item[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface ISearchParams<Filters> {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  searchTerm?: string;
  filters: Filters;
}
