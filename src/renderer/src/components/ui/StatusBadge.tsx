import { Icon, type IconName } from './Icon'

export function StatusBadge({
  label,
  tone = 'neutral',
  icon,
  iconOnly = false,
}: {
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'active'
  icon?: IconName
  iconOnly?: boolean
}) {
  return (
    <span className="status-badge" data-tone={tone} data-icon-only={iconOnly || undefined} aria-label={iconOnly ? label : undefined}>
      {icon === undefined ? null : <Icon name={icon} size={14} />}
      {iconOnly ? null : label}
    </span>
  )
}
