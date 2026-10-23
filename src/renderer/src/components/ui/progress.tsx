import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      className={cn('bg-line relative h-1.5 w-full overflow-hidden rounded-full', className)}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="bg-harbor h-full w-full flex-1 transition-transform motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
