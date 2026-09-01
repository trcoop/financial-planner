import { useEffect, useRef, useState } from 'react'
import { SelectField } from './components/SelectField/SelectField'
import { InvestmentCalculator } from './components/InvestmentCalculator/InvestmentCalculator'

export interface CalculatorEntry {
  id: string
  label: string
  component: () => React.ReactElement
}

// Plain local array of calculators (ERD decision — no router/registry framework). Adding a future
// second calculator only requires one more entry here plus its own component; nothing about
// `SelectField`, `LeftNav`, `TopBar`, or `BottomTabBar` needs to change.
const CALCULATORS: CalculatorEntry[] = [
  { id: 'investment', label: 'Investment Calculator', component: InvestmentCalculator },
]

export interface CalculatorsSectionProps {
  /**
   * Test-only seam: overrides the production `CALCULATORS` list so tests can exercise picker
   * swaps between two calculators without a real second calculator existing yet. Not intended
   * for production use.
   */
  calculators?: CalculatorEntry[]
}

export function CalculatorsSection({ calculators = CALCULATORS }: CalculatorsSectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [selectedId, setSelectedId] = useState(calculators[0].id)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const selected = calculators.find((entry) => entry.id === selectedId) ?? calculators[0]
  const SelectedCalculator = selected.component

  return (
    <section data-testid="calculators-section" data-selected-id={selectedId}>
      <header>
        <h1 ref={headingRef} tabIndex={-1}>
          Calculators
        </h1>
        <SelectField
          ariaLabel="Choose calculator"
          fullWidth={false}
          options={calculators.map(({ id, label }) => ({ value: id, label }))}
          value={selected.id}
          onChange={setSelectedId}
        />
      </header>

      <SelectedCalculator />
    </section>
  )
}
