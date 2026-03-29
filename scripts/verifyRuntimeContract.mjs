import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const mainBundle = join(repoRoot, 'dist-electron', 'main.js')
const sourceFallback = join(repoRoot, 'electron', 'main.ts')
const httpServiceSource = join(repoRoot, 'electron', 'services', 'httpService.ts')
const runtimeBuilderConfig = join(repoRoot, 'electron-builder.runtime.json')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(mainBundle) || existsSync(sourceFallback), `runtime entry not found: ${mainBundle} or ${sourceFallback}`)
assert(existsSync(runtimeBuilderConfig), `runtime builder config not found: ${runtimeBuilderConfig}`)

const preferBuilt = process.argv.includes('--built')
const entryPath = preferBuilt && existsSync(mainBundle) ? mainBundle : sourceFallback
const source = [
  readFileSync(entryPath, 'utf8'),
  existsSync(httpServiceSource) ? readFileSync(httpServiceSource, 'utf8') : ''
].join('\n')
const requiredMarkers = [
  '--hidden-backend',
  '--http-api-autostart',
  '--http-api-port',
  '/api/v1/runtime/status',
  '/api/v1/bootstrap/seed-config',
  'WEFLOW_INTEGRATION_TOKEN'
]

for (const marker of requiredMarkers) {
  assert(source.includes(marker), `runtime marker missing from source contract: ${marker}`)
}

console.log(`[verify:runtime] runtime contract markers present in ${entryPath}`)
