export interface Finding { key: string, kind: string, detail: string }
export interface VerifyResult {
  errors: Finding[]
  warnings: Finding[]
  stats: Record<string, number>
}
export function flatten(node: unknown, path?: string): Record<string, string>
export function verify(
  en: Record<string, unknown>,
  de: Record<string, unknown>,
  options?: { allowUntranslated?: string[], keys?: string[] },
): VerifyResult
