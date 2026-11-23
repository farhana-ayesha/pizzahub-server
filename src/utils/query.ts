export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function regexContains(value: string): RegExp {
  return new RegExp(escapeRegex(value), "i");
}

export function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
