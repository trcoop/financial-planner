import { useEffect, useRef } from 'react'

export interface CalculatorsSectionProps {}

export function CalculatorsSection(_props: CalculatorsSectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section>
      <h1 ref={headingRef} tabIndex={-1}>
        Calculators
      </h1>
      <p>No calculators yet — check back soon.</p>
    </section>
  )
}
