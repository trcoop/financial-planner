import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { Button } from '../Button/Button'
import { ConfirmDialog } from './ConfirmDialog'

export default {
  title: 'Composite / ConfirmDialog',
} satisfies StoryDefault

export const Open: Story = () => {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Reopen dialog</Button>
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

export const CustomLabels: Story = () => {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Reopen dialog</Button>
      <ConfirmDialog
        isOpen={isOpen}
        title="Discard changes?"
        message="You have unsaved edits to this person's profile."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => setIsOpen(false)}
        onCancel={() => setIsOpen(false)}
      />
    </>
  )
}

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
