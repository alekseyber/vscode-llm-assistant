// Ожидание по условию: в e2e нельзя спать фиксированное время — стриминг и события
// приходят асинхронно, а порядок между тестами разный.

export async function waitFor<T>(
  probe: () => T | Promise<T>,
  timeoutMs = 5000,
  stepMs = 50,
  what = 'условие',
): Promise<T> {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error(`Не дождались (${what}) за ${timeoutMs} мс; последнее значение: ${String(last)}`);
}
