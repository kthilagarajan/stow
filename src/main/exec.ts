import { spawn, type ChildProcess } from 'node:child_process'

export interface RunResult {
  stdout: string
  stderr: string
  timedOut: boolean
  code: number | null
}

export function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  track: (child: ChildProcess) => void,
  release: (child: ChildProcess) => void,
  stillCurrent: () => boolean
): Promise<RunResult> {
  return new Promise((resolve) => {
    if (!stillCurrent()) {
      resolve({ stdout: '', stderr: '', timedOut: false, code: null })
      return
    }

    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    track(child)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 8_000_000) stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 200_000) stderr += chunk.toString()
    })

    const finish = (code: number | null) => {
      clearTimeout(timer)
      release(child)
      resolve({ stdout, stderr, timedOut: timedOut && stillCurrent(), code })
    }

    child.on('error', () => finish(1))
    child.on('close', (code) => finish(code))
  })
}

// Like runCommand, but hands stdout through as it arrives so a folder can fill in before du exits.
export function streamCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  track: (child: ChildProcess, group?: boolean) => void,
  release: (child: ChildProcess) => void,
  stillCurrent: () => boolean,
  onChunk: (text: string) => void,
  // When true, the command is a process-group leader so stopping it also stops what it started.
  group = false
): Promise<RunResult> {
  return new Promise((resolve) => {
    if (!stillCurrent()) {
      resolve({ stdout: '', stderr: '', timedOut: false, code: null })
      return
    }

    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: group })
    track(child, group)
    const stop = (): void => {
      if (group && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
          return
        } catch {
          // The group is already gone.
        }
      }
      child.kill('SIGKILL')
    }
    let stderr = ''
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, timeoutMs)
    const watch = setInterval(() => {
      if (!stillCurrent()) stop()
    }, 200)

    child.stdout.on('data', (chunk: Buffer) => {
      if (!stillCurrent()) {
        stop()
        return
      }
      onChunk(chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 200_000) stderr += chunk.toString()
    })

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(watch)
      release(child)
      resolve({ stdout: '', stderr, timedOut: timedOut && stillCurrent(), code })
    }

    child.on('error', () => finish(1))
    child.on('close', (code) => finish(code))
  })
}
