import { copyFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } from 'electron'
import type {
  ConversationCreateInput,
  GenerateImageInput,
  HistoryListOptions,
  PromptAssistInput,
  ProviderInput,
  ProviderSettingsUpdate,
  ReferenceImageImportFile
} from '@shared/types'
import { AppDatabase } from './database'
import { copySelectedHistoryImages } from './batch-download'
import { prepareDataDir } from './data-path'
import { ImageService } from './image-service'
import { PromptService } from './prompt-service'
import { SettingsStore } from './settings'
import { createMainWindowOptions } from './window-options'
import { fetchProviderModels } from './provider-models'
import { enqueueThumbnail } from './thumbnail-native'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pictverse-image',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let database: AppDatabase
let settings: SettingsStore
let imageService: ImageService
let promptService: PromptService

function getDataDir(): string {
  return prepareDataDir({
    cwd: process.cwd(),
    packaged: app.isPackaged,
    exePath: app.getPath('exe'),
    userDataPath: app.getPath('userData')
  })
}

function createWindow(): void {
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow(createMainWindowOptions())
  mainWindow.setMenu(null)

  // 最大化状态变化时推给渲染层，供最大化/还原图标切换。
  // 必须挂在窗口实例上：registerWindowControls 执行时 mainWindow 尚未创建。
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximize-changed', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximize-changed', false))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerWindowControls(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize-toggle', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.on('window:is-maximized', (event) => {
    event.returnValue = mainWindow?.isMaximized() ?? false
  })
}

/**
 * id → 原图路径 的进程内缓存。
 * 协议每张图都要 filePath，但列表页一屏就是几十张，逐次查库是纯浪费。
 * id 是不可变 UUID，删除历史项时由 deleteHistory 负责失效，不会读到脏路径。
 */
const imagePathCache = new Map<string, string | null>()

function resolveImagePath(kind: string, id: string): string | null {
  const cacheKey = `${kind}:${id}`
  if (imagePathCache.has(cacheKey)) return imagePathCache.get(cacheKey) ?? null
  const filePath = kind === 'reference' ? database.getReferenceImage(id)?.filePath : database.getHistory(id)?.filePath
  const value = filePath ?? null
  imagePathCache.set(cacheKey, value)
  return value
}

export function invalidateImagePathCache(id: string): void {
  imagePathCache.delete(`image:${id}`)
  imagePathCache.delete(`reference:${id}`)
}

/** 缩略图宽度入参上限：只用于判断「这是不是缩略图请求」，不参与尺寸决策。 */
const MAX_THUMBNAIL_WIDTH = 2048

function parseWidthParam(url: URL): number {
  const raw = url.searchParams.get('w')
  if (!raw) return 0
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(MAX_THUMBNAIL_WIDTH, Math.round(value))
}

function registerImageProtocol(): void {
  protocol.handle('pictverse-image', async (request) => {
    const url = new URL(request.url)
    const kind = url.hostname
    const id = decodeURIComponent(url.pathname.replace(/^\//, '') || url.hostname)
    const filePath = resolveImagePath(kind, id)
    if (!filePath || !existsSync(filePath)) {
      return new Response(kind === 'reference' ? 'Reference image not found.' : 'Image not found.', { status: 404 })
    }

    const width = parseWidthParam(url)
    // 参考图不产缩略图（数量少、且要按原图送上游）；只有图片历史走缩略图。
    // 缩略图规格固定为 THUMBNAIL_MAX_EDGE，w 只作为「要缩略图」的开关：
    // 若按 w 生成，先到的请求会决定文件规格，后续更大的 w 会拿到模糊图。
    if (width > 0 && kind !== 'reference') {
      // 缩略图是纯优化：任何失败都必须回退原图，不能让图片请求整体失败。
      let servedPath = filePath
      try {
        servedPath = (await enqueueThumbnail(filePath)) ?? filePath
      } catch {
        servedPath = filePath
      }
      const response = await net.fetch(pathToFileURL(servedPath).toString())
      return withImageCacheHeaders(response, servedPath)
    }

    const response = await net.fetch(pathToFileURL(filePath).toString())
    return withImageCacheHeaders(response, filePath)
  })
}

/**
 * id 是 UUID，同 id 内容不会变，可以安全长缓存。
 * 缩略图路径含原始路径与宽度，同样稳定。
 */
function withImageCacheHeaders(response: Response, servedPath: string): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  if (servedPath.endsWith('.jpg')) headers.set('Content-Type', 'image/jpeg')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settings.getPublicSettings())
  ipcMain.handle('settings:update', (_event, input: ProviderSettingsUpdate) => {
    const next = settings.update(input)
    database.setExtraImageRoot(next.imagesRoot || null)
    return next
  })
  ipcMain.handle('settings:choose-images-root', async () => {
    const current = settings.getPublicSettings().imagesRootEffective
    const options = {
      title: '选择图片存储位置',
      defaultPath: current,
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('provider:list', () => database.listProviders())
  ipcMain.handle('provider:create', (_event, input: ProviderInput) => database.createProvider(input))
  ipcMain.handle('provider:update', (_event, id: string, input: ProviderInput) => database.updateProvider(id, input))
  ipcMain.handle('provider:remove', (_event, id: string) => database.removeProvider(id))
  ipcMain.handle('provider:set-default', (_event, id: string) => database.setDefaultProvider(id))
  ipcMain.handle('provider:models', (_event, providerId: string) => database.listProviderModels(providerId))
  ipcMain.handle('provider:save-models', (_event, providerId: string, modelIds: string[]) =>
    database.saveProviderModels(providerId, modelIds))
  ipcMain.handle('provider:fetch-models', async (_event, providerId: string) => {
    const provider = database.getProvider(providerId)
    if (!provider) throw new Error('供应商不存在。')
    return await fetchProviderModels(provider)
  })

  ipcMain.handle('conversation:list', () => database.listConversations())
  ipcMain.handle('conversation:create', (_event, input?: ConversationCreateInput) => database.createConversation(input))
  ipcMain.handle('conversation:update', (_event, id: string, input) => database.updateConversation(id, input))
  ipcMain.handle('conversation:delete', (_event, id: string) => database.deleteConversation(id))
  ipcMain.handle('conversation:runs', (_event, id: string) => database.listRuns(id))

  ipcMain.handle('history:list', (_event, options?: HistoryListOptions) => database.listHistory(options))
  ipcMain.handle('history:delete', (_event, id: string) => {
    const result = database.deleteHistory(id)
    invalidateImagePathCache(id)
    return result
  })
  ipcMain.handle('history:favorite', (_event, id: string, favorite: boolean) => database.setFavorite(id, favorite))

  ipcMain.handle('image:generate', (_event, input: GenerateImageInput) => imageService.generate(input))
  ipcMain.handle('image:cancel', (_event, runId: string, requestIndex?: number) =>
    imageService.cancelRunGeneration(runId, requestIndex))
  ipcMain.handle('image:url', (_event, id: string) => `pictverse-image://image/${encodeURIComponent(id)}`)
  ipcMain.handle('image:copy', (_event, id: string) => {
    const item = database.getHistory(id)
    if (!item?.filePath) throw new Error('Image file not found.')
    const image = nativeImage.createFromPath(item.filePath)
    if (image.isEmpty()) throw new Error('Unable to read image file.')
    clipboard.writeImage(image)
  })
  ipcMain.handle('image:download', async (_event, id: string) => {
    const item = database.getHistory(id)
    if (!item?.filePath) throw new Error('Image file not found.')
    const options = {
      title: '保存图片',
      defaultPath: basename(item.filePath),
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    copyFileSync(item.filePath, result.filePath)
    return result.filePath
  })
  ipcMain.handle('image:download-many', async (_event, ids: string[]) => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: '选择保存目录',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: '选择保存目录',
          properties: ['openDirectory', 'createDirectory']
        })
    const directory = result.filePaths[0]
    if (result.canceled || !directory) return null
    return copySelectedHistoryImages({
      ids,
      directory,
      getHistory: (id) => database.getHistory(id)
    })
  })
  ipcMain.handle('prompt:inspire', (_event, input?: PromptAssistInput) => promptService.inspire(input))
  ipcMain.handle('prompt:enrich', (_event, input: PromptAssistInput & { prompt: string }) => promptService.enrich(input))
  ipcMain.handle('reference:import-files', (_event, conversationId: string, files: ReferenceImageImportFile[]) => {
    for (const file of files) {
      database.createReferenceImageFromBytes({ conversationId, ...file })
    }
    return database.listConversationReferences(conversationId)
  })
  ipcMain.handle('reference:add-from-history', (_event, conversationId: string, historyId: string) => {
    database.addHistoryImageAsReference(conversationId, historyId)
    return database.listConversationReferences(conversationId)
  })
  ipcMain.handle('reference:remove', (_event, conversationId: string, referenceImageId: string) =>
    database.removeReferenceFromConversation(conversationId, referenceImageId))
  ipcMain.handle('reference:reorder', (_event, conversationId: string, referenceImageIds: string[]) =>
    database.reorderConversationReferences(conversationId, referenceImageIds))
  ipcMain.handle('reference:url', (_event, id: string) => `pictverse-image://reference/${encodeURIComponent(id)}`)
  ipcMain.handle('shell:open-path', (_event, filePath: string) => shell.openPath(filePath))
  ipcMain.handle('shell:open-external', (_event, rawUrl: string) => {
    if (typeof rawUrl !== 'string') return
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    void shell.openExternal(parsed.toString())
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  const dataDir = getDataDir()
  database = new AppDatabase(dataDir)
  database.recoverInterruptedRuns()
  // 旧版本删除会话/参考图时只删关联表，存量库里有孤儿行与孤儿文件；启动时收一次
  database.cleanupOrphanedReferences()
  settings = new SettingsStore(join(dataDir, 'settings.json'), database.imagesDir)
  database.setExtraImageRoot(settings.getPublicSettings().imagesRoot || null)
  imageService = new ImageService(database, settings)
  promptService = new PromptService(settings)
  registerImageProtocol()
  registerIpc()
  registerWindowControls()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  database?.close()
})
