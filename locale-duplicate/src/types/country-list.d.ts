declare module 'country-list' {
  export function getName(code: string): string | undefined;
  export function getCode(name: string): string | undefined;
  export function getNames(): string[];
  export function getCodes(): string[];
  export function getData(): Array<{code: string, name: string}>;
}
