import { OverflowAction, ButtonAction } from '@slack/bolt';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ALL_OPTION_VALUE } from '@modules/slack/common/views/data/all-option-value';
import { CheckboxesAction, StaticSelectAction } from '@slack/bolt/dist/types/actions/block-action';

type HandlerFn<Metadata> = (
  metadata: Metadata,
  user: IUserViewModel,
) => Promise<void>;

export function withPagination<Metadata extends { page?: number }>(
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const value = (payload.actions[0] as ButtonAction)?.value;

    if (!value) {
      return;
    }

    const page = parseInt(value, 10);
    const metadata: Metadata = payload.view?.private_metadata
      ? JSON.parse(payload.view.private_metadata)
      : {};

    await handler(
      {
        ...metadata,
        page,
      },
      user,
    );
  };
}

export function withSelectFilter<Metadata = unknown>(
  filterKey: string,
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const selectedValue = (payload.actions[0] as StaticSelectAction)
      .selected_option?.value;
    const metadata = payload.view?.private_metadata
      ? JSON.parse(payload.view.private_metadata)
      : {};

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {
        ...metadata.filters,
        [filterKey]:
          selectedValue === ALL_OPTION_VALUE ? undefined : selectedValue,
      },
    };

    await handler(updatedMetadata, user);
  };
}

export function withCheckboxFilter<Metadata = unknown>(
  filterKey: string,
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const selectedOptions = (payload.actions[0] as CheckboxesAction)
      .selected_options;
    const metadata = payload.view?.private_metadata
      ? JSON.parse(payload.view.private_metadata)
      : {};

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {
        ...metadata.filters,
        [filterKey]: selectedOptions.map((option) => option.value),
      },
    };

    await handler(updatedMetadata, user);
  };
}

export function withAsyncSelectFilter<Metadata = unknown>(
  filterKey: string,
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const selectedOption = (payload.actions[0] as OverflowAction)
      .selected_option;
    const metadata = payload.view?.private_metadata
      ? JSON.parse(payload.view.private_metadata)
      : {};

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {
        ...metadata.filters,
        [filterKey]:
          selectedOption && selectedOption.value !== ALL_OPTION_VALUE
            ? {
              value: selectedOption.value,
              name: selectedOption.text.text,
            }
            : undefined,
      },
    };

    await handler(updatedMetadata, user);
  };
}

export function withResetFilters<Metadata = unknown>(
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const metadata = payload.view?.private_metadata
      ? JSON.parse(payload.view.private_metadata)
      : {};

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {},
    };

    await handler(updatedMetadata, user);
  };
}
