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
