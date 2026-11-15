/**
 * 把 stdio 桥打成单文件：dist-mcp/pictverse-mcp.mjs
 *
 * 单文件的意义：客户端配置只需要指向这一个 .mjs，不需要 node_modules，
 * 也不需要用户额外装 Node（用 PictVerse.exe + ELECTRON_RUN_AS_NODE 就能跑）。
 */
import { mkdirSync } from 'node:fs'
import { build } from 'esbuild'

mkdirSync('dist-mcp', { recursive: true })

await build({
  entryPoints: ['src/mcp-bridge/index.ts'],
  outfile: 'dist-mcp/pictverse-mcp.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning'
})

console.log('built dist-mcp/pictverse-mcp.mjs')
