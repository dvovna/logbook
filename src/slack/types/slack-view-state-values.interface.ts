export interface IViewStateValues {
  [key: string]: {
    [key: string]: {
      value?: unknown;
      selected_date?: unknown;
      selected_option?: {
        value: unknown;
      };
    };
  };
}
