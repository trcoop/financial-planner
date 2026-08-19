import { forwardRef, type ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'secondary'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className, type = 'button', ...rest },
  ref,
) {
  const variantClass = variant === 'primary' ? styles.primary : styles.secondary
  const classNames = [styles.button, variantClass, className].filter(Boolean).join(' ')

  return <button ref={ref} type={type} className={classNames} {...rest} />
})
