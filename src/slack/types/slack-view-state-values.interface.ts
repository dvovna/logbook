export interface IViewStateValues {
  [blockId: string]: {
    [actionId: string]: {
      type: string;
      value?: string;
      selected_option?: { value: string };
      selected_user?: string;
    };
  };
}
