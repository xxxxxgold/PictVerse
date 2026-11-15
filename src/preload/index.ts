import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  HistoryListOptions,
  PictVerseAPI,
  PromptAssistInput,
  ProviderInput,
  ProviderSettingsUpdate,
  ReferenceImageImportFile
} from '@shared/types'

const api: PictVerseAPI = {
  provider: {
    list: () => ipcRenderer.invoke('provider:list'),
    create: (input: ProviderInput) => ipcRenderer.invoke('provider:create', input),
    update: (id: string, input: ProviderInput) => ipcRenderer.invoke('provider:update', id, input),
    remove: (id: string) => ipcRenderer.invoke('provider:remove', id),
    setDefault: (id: string) => ipcRenderer.invoke('provider:set-default', id),
    models: (providerId: string) => ipcRenderer.invoke('provider:models', providerId),
    fetchModels: (providerId: string) => ipcRenderer.invoke('provider:fetch-models', providerId),
    saveModels: (providerId: string, modelIds: string[]) => ipcRenderer.invoke('provider:save-models', providerId, modelIds)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (input: ProviderSettingsUpdate) => ipcRenderer.invoke('settings:update', input),
    chooseImagesRoot: () => ipcRenderer.invoke('settings:choose-images-root')
  },
  conversation: {
    list: () => ipcRenderer.invoke('conversation:list'),
    create: (input?: ConversationCreateInput) => ipcRenderer.invoke('conversation:create', input),
    update: (id: string, input: ConversationUpdate) => ipcRenderer.invoke('conversation:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('conversation:delete', id),
    runs: (id: string) => ipcRenderer.invoke('conversation:runs', id)
  },
  image: {
    generate: (input: GenerateImageInput) => ipcRenderer.invoke('image:generate', input),
    cancel: (runId: string, requestIndex?: number) => ipcRenderer.invoke('image:cancel', runId, requestIndex),
    url: (id: string, width?: number) =>
      width && width > 0
        ? `pictverse-image://image/${encodeURIComponent(id)}?w=${Math.round(width)}`
        : `pictverse-image://image/${encodeURIComponent(id)}`,
    copy: (id: string) => ipcRenderer.invoke('image:copy', id),
    download: (id: string) => ipcRenderer.invoke('image:download', id),
    downloadMany: (ids: string[]) => ipcRenderer.invoke('image:download-many', ids)
  },
  prompt: {
    inspire: (input?: PromptAssistInput) => ipcRenderer.invoke('prompt:inspire', input),
    enrich: (input: PromptAssistInput & { prompt: string }) => ipcRenderer.invoke('prompt:enrich', input)
  },
  history: {
    list: (options?: HistoryListOptions) => ipcRenderer.invoke('history:list', options),
    delete: (id: string) => ipcRenderer.invoke('history:delete', id),
    favorite: (id: string, favorite: boolean) => ipcRenderer.invoke('history:favorite', id, favorite)
  },
  reference: {
    importFiles: (conversationId: string, files: ReferenceImageImportFile[]) =>
      ipcRenderer.invoke('reference:import-files', conversationId, files),
    addFromHistory: (conversationId: string, historyId: string) =>
      ipcRenderer.invoke('reference:add-from-history', conversationId, historyId),
    remove: (conversationId: string, referenceImageId: string) =>
      ipcRenderer.invoke('reference:remove', conversationId, referenceImageId),
    reorder: (conversationId: string, referenceImageIds: string[]) =>
      ipcRenderer.invoke('reference:reorder', conversationId, referenceImageIds),
    url: (id: string) => `pictverse-image://reference/${encodeURIComponent(id)}`
  },
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:open-path', filePath),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('mcp:set-enabled', enabled),
    setPort: (port: number) => ipcRenderer.invoke('mcp:set-port', port),
    revealToken: () => ipcRenderer.invoke('mcp:reveal-token'),
    rotateToken: () => ipcRenderer.invoke('mcp:rotate-token'),
    logs: (options?: { page?: number; pageSize?: number; onlyErrors?: boolean }) => ipcRenderer.invoke('mcp:logs', options),
    clearLogs: () => ipcRenderer.invoke('mcp:clear-logs'),
    snippets: () => ipcRenderer.invoke('mcp:snippets')
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:maximize-toggle'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.sendSync('window:is-maximized'),
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
      const listener = (_event: unknown, isMaximized: boolean): void => callback(isMaximized)
      ipcRenderer.on('window:maximize-changed', listener)
      return () => ipcRenderer.removeListener('window:maximize-changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('pictverse', api)
