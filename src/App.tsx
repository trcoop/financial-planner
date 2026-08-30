import { useState } from 'react'
import { TopBar } from './ui/components/TopBar/TopBar'
import { LeftNav, type NavItem } from './ui/components/LeftNav/LeftNav'
import { BottomTabBar } from './ui/components/BottomTabBar/BottomTabBar'
import { ChartIcon } from './ui/components/icons/ChartIcon'
import { GridIcon } from './ui/components/icons/GridIcon'
import { PlanSection } from './ui/PlanSection'
import { CalculatorsSection } from './ui/CalculatorsSection'
import './App.css'

/** App.tsx's own section union — the one place a new section is registered (extensibility
 * check, PRD Success Metrics: a hypothetical third section only needs a new member here, a
 * new `*Section` component below, and one new entry in NAV_ITEMS — no change to LeftNav,
 * TopBar, TabBar, or BottomTabBar themselves). */
type SectionId = 'plan' | 'calculators'

/** Shared item list for both LeftNav (desktop) and BottomTabBar (mobile) — see App.css's
 * `.navPane`/`.bottomNavPane` for how visibility switches between them. `icon` is only
 * consumed by BottomTabBar; LeftNav ignores it at P0 (text-only), per the ERD's pinned
 * NavItem contract. */
const NAV_ITEMS: NavItem[] = [
  { id: 'plan', label: 'Plan', icon: ChartIcon },
  { id: 'calculators', label: 'Calculators', icon: GridIcon },
]

function isSectionId(id: NavItem['id']): id is SectionId {
  return id === 'plan' || id === 'calculators'
}

function App() {
  // Plain useState, no persistence (PRD: refresh always lands on Plan).
  const [activeSection, setActiveSection] = useState<SectionId>('plan')

  function handleSelect(id: NavItem['id']) {
    if (isSectionId(id)) setActiveSection(id)
  }

  return (
    <div className="shell">
      <TopBar />
      <div className="body">
        <div className="navPane">
          <LeftNav items={NAV_ITEMS} activeId={activeSection} onSelect={handleSelect} />
        </div>
        <div className="main">
          {/* Section-render algorithm: a genuine JS conditional (ternary) — the inactive
            * section unmounts entirely, distinct from the CSS-only dual-mount used for
            * LeftNav/BottomTabBar above/below (ERD §6). */}
          {activeSection === 'plan' ? <PlanSection /> : <CalculatorsSection />}
        </div>
      </div>
      <div className="bottomNavPane">
        <BottomTabBar items={NAV_ITEMS} activeId={activeSection} onSelect={handleSelect} />
      </div>
    </div>
  )
}

export default App
