import type { Story, StoryDefault } from '@ladle/react'
import { Table, TableRow } from './Table'

export default {
  title: 'Composite / Table',
} satisfies StoryDefault

export const Default: Story = () => (
  <Table caption="Sample data">
    <thead>
      <tr>
        <th scope="col">Year</th>
        <th scope="col">Balance</th>
      </tr>
    </thead>
    <tbody>
      <TableRow>
        <td>1</td>
        <td>$100,000</td>
      </TableRow>
      <TableRow highlighted>
        <td>2</td>
        <td>$110,000</td>
      </TableRow>
    </tbody>
  </Table>
)
