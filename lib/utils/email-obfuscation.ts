export function obfuscateEmail(email: string): string {
  return email
    .split('')
    .map((c) => `&#${c.charCodeAt(0)};`)
    .join('')
}
