#!/usr/bin/env node
/**
 * 用 Electron 自带的 Node 运行 vitest。
 *
 * 背景：package.json 的 postinstall（electron-builder install-app-deps）会把
 * better-sqlite3 等原生模块重建成 Electron 的 ABI（本机 NODE_MODULE_VERSION 132），
 * 而系统 Node 22 需要 127。于是纯 Node 下 vitest dlopen 失败，
 * src/main/capability-migration.test.ts 只能 ctx.skip()，DB 迁移逻辑因此零覆盖。
 *
 * 用 ELECTRON_RUN_AS_NODE=1 让 electron 以 Node 身份启动，ABI 天然匹配，
 * 不需要动安装产物，也不会破坏桌面端加载。
 *
 * 用法：
 *   node scripts/run-native-tests.mjs                # 跑全部用例
 *   node scripts/run-native-tests.mjs src/main/...   # 只跑指定文件
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let electronPath
try {
  electronPath = require('electron')
} catch {
  console.error('[test:native] 无法解析 electron 依赖，请先执行 pnpm install')
  process.exit(1)
}

if (typeof electronPath !== 'string' || !existsSync(electronPath)) {
  console.error(`[test:native] Electron 可执行文件不存在：${electronPath}`)
  process.exit(1)
}

const vitestDir = dirname(require.resolve('vitest/package.json'))
const vitestEntry = join(vitestDir, 'vitest.mjs')
if (!existsSync(vitestEntry)) {
  console.error(`[test:native] 找不到 vitest 入口：${vitestEntry}`)
  process.exit(1)
}

const args = [vitestEntry, 'run', ...process.argv.slice(2)]
const result = spawnSync(electronPath, args, {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

if (result.error) {
  console.error(`[test:native] 启动 Electron 失败：${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
