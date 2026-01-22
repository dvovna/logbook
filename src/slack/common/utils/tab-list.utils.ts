import { ButtonAction } from '@slack/bolt';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ALL_OPTION_VALUE } from '@modules/slack/common/views/data/all-option-value';
import { getCheckboxActionValues, getSelectActionValue } from '@modules/slack/common/utils/payload.utils';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';

interface IMetadataWithFilters {
  filters?: Record<string, unknown>;
}

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
    const metadata = parseMetadata<Metadata>(payload);

    await handler(
      {
        ...metadata,
        page,
      },
      user,
    );
  };
}

export function withSelectFilter<Metadata extends IMetadataWithFilters>(
  filterKey: string,
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const selectedOption = getSelectActionValue(payload);
    const metadata = parseMetadata<Metadata>(payload);

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {
        ...metadata.filters,
        [filterKey]:
          selectedOption?.id === ALL_OPTION_VALUE ? undefined : selectedOption?.id,
      },
    };

    await handler(updatedMetadata, user);
  };
}

export function withCheckboxFilter<Metadata extends IMetadataWithFilters>(
  filterKey: string,
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const selectedValues = getCheckboxActionValues(payload);
    const metadata = parseMetadata<Metadata>(payload);

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {
        ...metadata.filters,
        [filterKey]: selectedValues,
      },
    };

    await handler(updatedMetadata, user);
  };
}

export function withAsyncSelectFilter<Metadata extends IMetadataWithFilters>(
  filterKey: string,
  handler: HandlerFn<Metadata>,
) {
  return async (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const selectedOption = getSelectActionValue(payload);
    const metadata = parseMetadata<Metadata>(payload);

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {
        ...metadata.filters,
        [filterKey]:
          selectedOption && selectedOption.id !== ALL_OPTION_VALUE
            ? {
              value: selectedOption.id,
              name: selectedOption.name,
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
    const metadata = parseMetadata<Metadata>(payload);

    const updatedMetadata: Metadata = {
      ...metadata,
      page: 1,
      filters: {},
    };

    await handler(updatedMetadata, user);
  };
}
