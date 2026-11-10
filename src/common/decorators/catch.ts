const Catch = (handler: (error: unknown) => void | never): MethodDecorator => {
  return (target, key, descriptor: PropertyDescriptor) => {
    const { value } = descriptor;

    if (!value) {
      return;
    }

    descriptor.value = async function (...args: unknown[]) {
      try {
        const result = value.apply(this, args);

        if (result && result instanceof Promise) {
          return result.catch((error) => {
            handler(error);

            // If handler doesn't throw an error, throw the original error
            throw error;
          });
        }

        return result;
      } catch (error) {
        handler(error);

        // If handler doesn't throw an error, throw the original error
        throw error;
      }
    };

    return descriptor;
  };
};

export default Catch;
