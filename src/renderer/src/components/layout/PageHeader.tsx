import { forwardRef, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'

export const PageHeader = forwardRef<
  HTMLHeadingElement,
  {
    eyebrow?: string
    title: ReactNode
    description?: string
    backLabel?: string
    onBack?(): void
    trailing?: ReactNode
  }
>(function PageHeader({ eyebrow, title, description, backLabel, onBack, trailing }, ref) {
  return (
    <header className="page-header">
      {backLabel === undefined || onBack === undefined ? null : (
        <button type="button" className="back-button" onClick={onBack}>
          <Icon name="back" />
          {backLabel}
        </button>
      )}
      <div className="page-header-row">
        <div>
          {eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}
          <h1 ref={ref} tabIndex={-1}>
            {title}
          </h1>
          {description === undefined ? null : <p>{description}</p>}
        </div>
        {trailing}
      </div>
    </header>
  )
})
