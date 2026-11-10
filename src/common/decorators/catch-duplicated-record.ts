import Catch from './catch';
import { ValidationError } from '@common/errors/validation.error';

const CatchDuplicatedRecord = (message: string) => {
  return Catch((error: Error) => {
    if (error.message.includes('duplicate key value')) {
      throw new ValidationError(message, 'name');
    }
  });
};

export default CatchDuplicatedRecord;
