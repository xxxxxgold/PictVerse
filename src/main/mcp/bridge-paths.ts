/**
 * stdio 桥的启动路径解析（纯函数，可单测）。
 *
 * 关键点：配置片段里的路径必须跟着「软件当前所在位置」走，不能写死。
 * - 打包版：命令就是安装目录里的 PictVerse.exe，脚本在 resources/mcp 下；
 * - 开发版：process.execPath 指向 node_modules/.pnpm/electron@34.5.8/... 这种带版本号的
 *   真实目录，换个小版本就失效。这里优先取 node_modules/electron/dist 这个稳定入口，
 *   拿不到再退回 execPath。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type BridgeLaunch = {
  command: string
  args: string[]
  env: Record<string, string>
}

export type BridgePathInput = {
  isPackaged: boolean
  execPath: string
  /** 开发态的项目根目录（app.getAppPath()） */
  appPath: string
  /** 打包态的 resources 目录（process.resourcesPath） */
  resourcesPath: string
  platform?: NodeJS.Platform
  /** 便于测试注入 */
  exists?: (path: string) => boolean
}

export function resolveBridgeScriptPath(input: Pick<BridgePathInput, 'isPackaged' | 'appPath' | 'resourcesPath'>): string {
  return input.isPackaged
    ? join(input.resourcesPath, 'mcp', 'pictverse-mcp.mjs')
    : join(input.appPath, 'dist-mcp', 'pictverse-mcp.mjs')
}

/** 开发态下 electron 可执行文件的稳定入口（绕开 .pnpm 的带版本目录） */
export function resolveDevElectronPath(appPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return join(appPath, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  }
  if (platform === 'win32') {
    return join(appPath, 'node_modules', 'electron', 'dist', 'electron.exe')
  }
  return join(appPath, 'node_modules', 'electron', 'dist', 'electron')
}

/**
 * 返回可直接写进客户端配置的启动信息。
 * 脚本没构建出来时返回 null：宁可只给 HTTP 片段，也不给一条注定跑不起来的命令。
 */
export function resolveBridgeLaunch(input: BridgePathInput): BridgeLaunch | null {
  const exists = input.exists ?? existsSync
  const platform = input.platform ?? process.platform
  const script = resolveBridgeScriptPath(input)
  if (!exists(script)) return null

  let command = input.execPath
  if (!input.isPackaged) {
    const stable = resolveDevElectronPath(input.appPath, platform)
    if (exists(stable)) command = stable
  }

  return {
    command,
    args: [script],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}
