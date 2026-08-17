const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
})

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

/** `value` is a plain percentage (e.g. 15 for 15%), not a 0-1 fraction. */
export function formatPercent(value: number): string {
  return percentFormatter.format(value / 100)
}
