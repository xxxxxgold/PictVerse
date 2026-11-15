import { join } from 'node:path'
import { app } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'

export function createMainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 1040,
    minWidth: 1120,
    minHeight: 760,
    title: '绘世',
    icon: resolveWindowIconPath(),
    backgroundColor: '#f5f8f6',
    autoHideMenuBar: true,
    // 隐藏系统标题栏：顶栏卡片兼作拖拽区，窗口控制按钮由 Topbar 自绘。
    // 不用 titleBarOverlay：原生按钮画在窗口右上角，会压住顶栏卡片和「新建会话」，
    // 且颜色写死、无法跟随深色主题。
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  }
}

function resolveWindowIconPath(): string {
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  if (app?.isPackaged) {
    return join(process.resourcesPath, iconFileName)
  }
  return join(process.cwd(), `src/renderer/src/assets/${iconFileName}`)
}
