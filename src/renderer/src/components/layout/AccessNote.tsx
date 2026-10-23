import { EyeOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStoredFlag } from '@/hooks/useStoredFlag'

// Shown when macOS refused to list some folders. It can be dismissed for good.
export function AccessNote({ limited }: { limited: number }) {
  const [hidden, setHidden] = useStoredFlag('stow.hideAccessNote')
  if (limited <= 0 || hidden) return null
  return (
    <div className="fade-in bg-sheet/70 mt-3 flex items-center gap-3 rounded-xl py-1.5 pr-1.5 pl-3">
      <EyeOff className="text-mist size-4 shrink-0" aria-hidden />
      <p className="text-mist min-w-0 flex-1 text-xs leading-relaxed">
        macOS hid files in {limited === 1 ? 'one folder' : `${limited} folders`}, so those sizes may be low. Full Disk Access in
        System Settings lets Stow see them.
      </p>
      <Button variant="ghost" size="icon" aria-label="Hide this note" title="Hide this note" onClick={() => setHidden(true)}>
        <X aria-hidden />
      </Button>
    </div>
  )
}
