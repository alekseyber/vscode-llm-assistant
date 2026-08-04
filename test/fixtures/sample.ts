// Пример файла для тестов контекста ContextBuilder
// Этот файл используется в тестах для проверки сбора контекста

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

// Класс для тестирования
export class Calculator {
  private values: number[] = [];

  push(value: number): void {
    this.values.push(value);
  }

  sum(): number {
    return this.values.reduce((acc, v) => acc + v, 0);
  }

  average(): number {
    if (this.values.length === 0) return 0;
    return this.sum() / this.values.length;
  }
}

// Многострочный текст для проверки ограничения по строкам
// Строка 1
// Строка 2
// Строка 3
// Строка 4
// Строка 5
// Строка 6
// Строка 7
// Строка 8
// Строка 9
// Строка 10