import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Table, TableRow } from './Table'

describe('Table', () => {
  afterEach(() => cleanup())
  it('renders a table with the given caption', () => {
    render(
      <Table caption="Year-by-year projection">
        <tbody>
          <TableRow>
            <td>Row content</td>
          </TableRow>
        </tbody>
      </Table>,
    )
    expect(screen.getByRole('table', { name: 'Year-by-year projection' })).toBeInTheDocument()
  })

  it('renders without a caption when none is given', () => {
    render(
      <Table>
        <tbody>
          <TableRow>
            <td>Row content</td>
          </TableRow>
        </tbody>
      </Table>,
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('marks a row as highlighted via a data attribute, not visually only', () => {
    render(
      <Table caption="Year-by-year projection">
        <tbody>
          <TableRow highlighted>
            <td>Retirement year</td>
          </TableRow>
        </tbody>
      </Table>,
    )
    expect(screen.getByRole('row', { name: 'Retirement year' })).toHaveAttribute(
      'data-highlighted',
      'true',
    )
  })

  it('does not set data-highlighted on a normal row', () => {
    render(
      <Table caption="Year-by-year projection">
        <tbody>
          <TableRow>
            <td>Regular year</td>
          </TableRow>
        </tbody>
      </Table>,
    )
    expect(screen.getByRole('row', { name: 'Regular year' })).not.toHaveAttribute(
      'data-highlighted',
    )
  })
})
