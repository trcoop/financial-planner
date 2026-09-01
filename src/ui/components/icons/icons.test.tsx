import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartIcon } from './ChartIcon'
import { GridIcon } from './GridIcon'
import { CalculatorIcon } from './CalculatorIcon'
import { PeopleIcon } from './PeopleIcon'
import { WalletIcon } from './WalletIcon'
import { PercentIcon } from './PercentIcon'

describe.each([
  ['ChartIcon', ChartIcon],
  ['GridIcon', GridIcon],
  ['CalculatorIcon', CalculatorIcon],
  ['PeopleIcon', PeopleIcon],
  ['WalletIcon', WalletIcon],
  ['PercentIcon', PercentIcon],
])('%s', (name, Icon) => {
  it('renders an inline svg', () => {
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg?.tagName.toLowerCase()).toBe('svg')
  })

  it('forwards a className to the svg element', () => {
    const { container } = render(<Icon className="custom-class" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('custom-class')
  })

  it('renders without a className without throwing', () => {
    expect(() => render(<Icon />)).not.toThrow()
  })

  it(`${name} has no network references (no <image>/href to external resources)`, () => {
    const { container } = render(<Icon />)
    expect(container.querySelector('image')).not.toBeInTheDocument()
    const svg = container.querySelector('svg')
    expect(svg?.outerHTML).not.toMatch(/https?:\/\//)
  })
})
