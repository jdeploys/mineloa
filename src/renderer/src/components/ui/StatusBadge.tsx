import { Icon, type IconName } from './Icon'

export function StatusBadge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'active'
  icon?: IconName
}) {
  return (
    <span className="status-badge" data-tone={tone}>
      {icon === undefined ? null : <Icon name={icon} size={14} />}
      {label}
    </span>
  )
}
