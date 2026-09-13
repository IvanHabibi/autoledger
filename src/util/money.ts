/**
 * Rupiah formatting. Deliberately not Intl.NumberFormat: ICU emits a
 * non-breaking space after "Rp" on some builds and a plain space on others,
 * which makes tests and Telegram output quietly inconsistent between machines.
 */

/** 1234567 → "1.234.567" (Indonesian convention: dot groups thousands). */
export function groupDigits(value: number): string {
  const whole = Math.abs(Math.trunc(value)).toString();
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 50000 → "Rp 50.000"; -50000 → "-Rp 50.000". */
export function formatIdr(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}Rp ${groupDigits(value)}`;
}
