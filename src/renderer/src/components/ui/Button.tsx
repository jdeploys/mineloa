import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: IconName
}

export function Button({ variant = 'secondary', className = '', icon, children, ...props }: ButtonProps) {
  return (
    <button className={`ui-button ${className}`.trim()} data-variant={variant} {...props}>
      {icon === undefined ? null : <Icon name={icon} />}
      {children}
    </button>
  )
}
