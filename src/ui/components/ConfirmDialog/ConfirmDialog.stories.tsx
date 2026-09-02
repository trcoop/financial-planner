import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { Button } from '../Button/Button'
import { ConfirmDialog } from './ConfirmDialog'

export default {
  title: 'Composite / ConfirmDialog',
} satisfies StoryDefault

export const Open: Story = () => (
  <ConfirmDialog
    isOpen
    title="Delete account?"
    message="This removes the account and its contribution history. This can't be undone."
    onConfirm={() => {}}
    onCancel={() => {}}
  />
)

export const CustomLabels: Story = () => (
  <ConfirmDialog
    isOpen
    title="Discard changes?"
    message="You have unsaved edits to this person's profile."
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    onConfirm={() => {}}
    onCancel={() => {}}
  />
)

export const Interactive: Story = () => {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Delete account</Button>
      <ConfirmDialog
        isOpen={isOpen}
        title="Delete account?"
        message="This removes the account and its contribution history. This can't be undone."
        onConfirm={() => setIsOpen(false)}
        onCancel={() => setIsOpen(false)}
      />
    </>
  )
}
