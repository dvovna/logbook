// Resolves true once `work` resolves, or false when `ms` pass first; rejects
// when `work` does in time. The timer doesn't outlive the work.
export const finishesWithin = async (
  work: Promise<unknown>,
  ms: number,
): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });

  try {
    return await Promise.race([work.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
};
