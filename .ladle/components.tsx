// Ladle never executes src/main.tsx, so without this import every story would render with all
// theme.css tokens unresolved (default browser fonts/colors, no spacing scale) — defeating the
// catalog's purpose as the component-reuse reference (Component Library spec, "Ladle setup").
import '../src/ui/theme.css'
