import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Download,
  FileOutput,
  FileText,
  FileUp,
  KeyRound,
  Library,
  LoaderCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'

export type IconName =
  | 'library' | 'template' | 'settings' | 'import' | 'back'
  | 'microphone' | 'recording' | 'pause' | 'play' | 'stop'
  | 'save' | 'delete' | 'download' | 'export' | 'retry'
  | 'up' | 'down' | 'forward' | 'success' | 'warning' | 'error' | 'processing'
  | 'add' | 'edit' | 'key' | 'model' | 'terminal' | 'close'

const icons: Record<IconName, LucideIcon> = {
  library: Library,
  template: FileText,
  settings: Settings2,
  import: FileUp,
  back: ArrowLeft,
  microphone: Mic,
  recording: CircleDot,
  pause: Pause,
  play: Play,
  stop: Square,
  save: Save,
  delete: Trash2,
  download: Download,
  export: FileOutput,
  retry: RotateCcw,
  up: ChevronUp,
  down: ChevronDown,
  forward: ArrowRight,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
  processing: LoaderCircle,
  add: Plus,
  edit: Pencil,
  key: KeyRound,
  model: BrainCircuit,
  terminal: Terminal,
  close: X,
}

export function Icon({ name, size = 18, className = '' }: {
  name: IconName
  size?: number
  className?: string
}) {
  const Component = icons[name]
  return (
    <Component
      aria-hidden="true"
      className={`ui-icon ${className}`.trim()}
      focusable="false"
      size={size}
      strokeWidth={2}
    />
  )
}
