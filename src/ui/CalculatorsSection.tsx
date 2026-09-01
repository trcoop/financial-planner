import { useEffect, useRef, useState } from 'react'
import { CalculatorPicker } from './components/CalculatorPicker/CalculatorPicker'
import { InvestmentCalculator } from './components/InvestmentCalculator/InvestmentCalculator'

export interface CalculatorsSectionProps {}

interface CalculatorEntry {
  id: string
  label: string
  component: () => React.ReactElement
}

// Plain local array of calculators (ERD decision — no router/registry framework). Adding a future
// second calculator only requires one more entry here plus its own component; nothing about
// `CalculatorPicker`, `LeftNav`, `TopBar`, or `BottomTabBar` needs to change.
const CALCULATORS: CalculatorEntry[] = [
  { id: 'investment', label: 'Investment Calculator', component: InvestmentCalculator },
]

export function CalculatorsSection(_props: CalculatorsSectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [selectedId, setSelectedId] = useState(CALCULATORS[0].id)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const selected = CALCULATORS.find((entry) => entry.id === selectedId) ?? CALCULATORS[0]
  const SelectedCalculator = selected.component

  return (
    <section>
      <header>
        <h1 ref={headingRef} tabIndex={-1}>
          Calculators
        </h1>
        <CalculatorPicker
          options={CALCULATORS.map(({ id, label }) => ({ id, label }))}
          selectedId={selected.id}
          onSelect={setSelectedId}
        />
      </header>

      <SelectedCalculator />
    </section>
  )
}
