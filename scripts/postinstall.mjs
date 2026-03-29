import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.WEFLOW_SKIP_INSTALL_APP_DEPS === '1' || process.env.CI === 'true') {
  console.log('[WeFlow][postinstall] Skipping electron-builder install-app-deps')
  process.exit(0)
}

const localBin = process.platform === 'win32'
  ? join(process.cwd(), 'node_modules', '.bin', 'electron-builder.cmd')
  : join(process.cwd(), 'node_modules', '.bin', 'electron-builder')

const command = existsSync(localBin)
  ? localBin
  : (process.platform === 'win32' ? 'npx.cmd' : 'npx')

const args = existsSync(localBin) ? ['install-app-deps'] : ['electron-builder', 'install-app-deps']
const result = spawnSync(command, args, {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
  shell: false
})

if ((result.status ?? 1) !== 0) {
  console.error('\n[WeFlow][postinstall] electron-builder install-app-deps failed.')
  console.error('[WeFlow][postinstall] If the error mentions ajv/schema-utils on Windows, delete node_modules + package-lock.json and reinstall after pulling the webot patch.')
  process.exit(result.status ?? 1)
}
