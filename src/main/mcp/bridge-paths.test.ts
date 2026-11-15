import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBridgeLaunch, resolveBridgeScriptPath, resolveDevElectronPath } from './bridge-paths'

const APP_PATH = 'D:\\dsh\\PictVerse'
const RESOURCES = 'C:\\Program Files\\PictVerse\\resources'

describe('stdio 桥的路径解析', () => {
  it('打包态：命令用安装目录里的 exe，脚本在 resources/mcp', () => {
    const launch = resolveBridgeLaunch({
      isPackaged: true,
      execPath: join(RESOURCES, '..', 'PictVerse.exe'),
      appPath: RESOURCES,
      resourcesPath: RESOURCES,
      exists: () => true
    })
    expect(launch).not.toBeNull()
    expect(launch!.command).toBe(join(RESOURCES, '..', 'PictVerse.exe'))
    expect(launch!.args).toEqual([join(RESOURCES, 'mcp', 'pictverse-mcp.mjs')])
    expect(launch!.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('开发态：优先用 node_modules/electron/dist 的稳定入口，绕开 .pnpm 带版本目录', () => {
    const launch = resolveBridgeLaunch({
      isPackaged: false,
      // 真实的 process.execPath 长这样，换个小版本就失效
      execPath: 'D:\\dsh\\PictVerse\\node_modules\\.pnpm\\electron@34.5.8\\node_modules\\electron\\dist\\electron.exe',
      appPath: APP_PATH,
      resourcesPath: RESOURCES,
      platform: 'win32',
      exists: () => true
    })
    expect(launch!.command).toBe(join(APP_PATH, 'node_modules', 'electron', 'dist', 'electron.exe'))
    expect(launch!.command).not.toContain('.pnpm')
    expect(launch!.args).toEqual([join(APP_PATH, 'dist-mcp', 'pictverse-mcp.mjs')])
  })

  it('开发态：稳定入口不存在时回退到 execPath，而不是给空命令', () => {
    const execPath = 'D:\\dsh\\PictVerse\\node_modules\\.pnpm\\electron@34.5.8\\node_modules\\electron\\dist\\electron.exe'
    const launch = resolveBridgeLaunch({
      isPackaged: false,
      execPath,
      appPath: APP_PATH,
      resourcesPath: RESOURCES,
      platform: 'win32',
      exists: (path) => path.endsWith('pictverse-mcp.mjs')
    })
    expect(launch!.command).toBe(execPath)
  })

  it('桥包还没构建出来时返回 null，只留 HTTP 片段', () => {
    const launch = resolveBridgeLaunch({
      isPackaged: false,
      execPath: 'node.exe',
      appPath: APP_PATH,
      resourcesPath: RESOURCES,
      platform: 'win32',
      exists: () => false
    })
    expect(launch).toBeNull()
  })

  it('脚本路径随打包状态切换', () => {
    expect(resolveBridgeScriptPath({ isPackaged: true, appPath: APP_PATH, resourcesPath: RESOURCES }))
      .toBe(join(RESOURCES, 'mcp', 'pictverse-mcp.mjs'))
    expect(resolveBridgeScriptPath({ isPackaged: false, appPath: APP_PATH, resourcesPath: RESOURCES }))
      .toBe(join(APP_PATH, 'dist-mcp', 'pictverse-mcp.mjs'))
  })

  it('macOS 稳定入口是 .app 内的可执行文件', () => {
    // 期望值用 join 拼，测试跑在 Windows 上时也不会因为分隔符失败
    expect(resolveDevElectronPath('/Users/me/PictVerse', 'darwin'))
      .toBe(join('/Users/me/PictVerse', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'))
    expect(resolveDevElectronPath('/home/me/PictVerse', 'linux'))
      .toBe(join('/home/me/PictVerse', 'node_modules', 'electron', 'dist', 'electron'))
  })
})
