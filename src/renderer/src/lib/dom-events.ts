export function eventChecked(event: Event): boolean {
  return Boolean((event.target as HTMLInputElement | null)?.checked);
}

export function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
}
