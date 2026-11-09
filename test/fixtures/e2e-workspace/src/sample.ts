// Фикстура для e2e: маленький файл, который тесты могут править безопасно.
export function sum(a: number, b: number): number {
  return a + b;
}

export const E2E_FIXTURE_MARKER = 'fixture-sample-v1';
