// Formatting shared by the Host (notifications) and the pages (progress window).

/** Decimal units, as Finder shows them: 84 MB is 84,000,000 bytes. */
export function formatSize(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
