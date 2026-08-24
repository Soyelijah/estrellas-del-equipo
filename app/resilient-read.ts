export async function retryRead<T>(
  operation: (attempt: number) => Promise<T>,
  retryDelaysMs: readonly number[],
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index <= retryDelaysMs.length; index += 1) {
    try {
      return await operation(index + 1);
    } catch (error) {
      lastError = error;
      if (index === retryDelaysMs.length) break;
      await wait(retryDelaysMs[index]);
    }
  }
  throw lastError;
}
