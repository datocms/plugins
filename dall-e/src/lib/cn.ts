export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassValue[]
  | { [key: string]: unknown };

function appendClass(accumulator: string[], value: ClassValue): void {
  if (!value) {
    return;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    accumulator.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => appendClass(accumulator, item));
    return;
  }

  Object.entries(value).forEach(([key, enabled]) => {
    if (enabled) {
      accumulator.push(key);
    }
  });
}

export function cn(...inputs: ClassValue[]): string {
  const values: string[] = [];
  inputs.forEach((value) => appendClass(values, value));
  return values.join(' ');
}
