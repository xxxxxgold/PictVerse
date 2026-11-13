import type {
  Conversation,
  GenerationRun,
  ImageHistoryItem,
  ReferenceImage
} from '@shared/types'

export type WebImageBlobRecord = {
  id: string
  historyId: string
  blob: Blob
  mimeType: string
  fileName: string
  fileSizeBytes: number
  createdAt: string
}

export type WebReferenceBlobRecord = {
  id: string
  referenceImageId: string
  blob: Blob
}

const 数据库名称 = 'PictVerseWebDB'
const 数据库版本 = 2

let 数据库连接: Promise<IDBDatabase> | null = null

export function openWebDatabase(): Promise<IDBDatabase> {
  if (!数据库连接) {
    数据库连接 = new Promise((resolve, reject) => {
      const request = indexedDB.open(数据库名称, 数据库版本)
      request.onerror = () => reject(request.error || new Error('无法打开浏览器本地数据库。'))
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const db = request.result
        createStore(db, 'settings')
        const conversations = createStore(db, 'conversations')
        conversations.createIndex('updatedAt', 'updatedAt')
        const generationRuns = createStore(db, 'generationRuns')
        generationRuns.createIndex('conversationId', 'conversationId')
        generationRuns.createIndex('createdAt', 'createdAt')
        const imageHistory = createStore(db, 'imageHistory')
        imageHistory.createIndex('conversationId', 'conversationId')
        imageHistory.createIndex('runId', 'runId')
        imageHistory.createIndex('createdAt', 'createdAt')
        const imageBlobs = createStore(db, 'imageBlobs')
        imageBlobs.createIndex('historyId', 'historyId', { unique: true })
        const referenceImages = createStore(db, 'referenceImages')
        referenceImages.createIndex('conversationId', 'conversationId')
        referenceImages.createIndex('sortOrder', 'sortOrder')
        const referenceImageBlobs = createStore(db, 'referenceImageBlobs')
        createStore(db, 'providers')
        createStore(db, 'providerModels')
        referenceImageBlobs.createIndex('referenceImageId', 'referenceImageId', { unique: true })
      }
    })
  }
  return 数据库连接
}

function createStore(db: IDBDatabase, name: string): IDBObjectStore {
  return db.createObjectStore(name, { keyPath: 'id' })
}

export async function getRecord<T>(storeName: string, id: string): Promise<T | null> {
  const db = await openWebDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(id)
    request.onerror = () => reject(request.error || new Error('读取本地数据失败。'))
    request.onsuccess = () => resolve((request.result as T | undefined) || null)
  })
}

export async function putRecord<T extends { id: string }>(storeName: string, value: T): Promise<T> {
  const db = await openWebDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.onerror = () => reject(tx.error || new Error('写入本地数据失败。'))
    tx.oncomplete = () => resolve(value)
    tx.objectStore(storeName).put(value)
  })
}

export async function deleteRecord(storeName: string, id: string): Promise<void> {
  const db = await openWebDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.onerror = () => reject(tx.error || new Error('删除本地数据失败。'))
    tx.oncomplete = () => resolve()
    tx.objectStore(storeName).delete(id)
  })
}

export async function listRecords<T>(storeName: string): Promise<T[]> {
  const db = await openWebDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).getAll()
    request.onerror = () => reject(request.error || new Error('读取本地列表失败。'))
    request.onsuccess = () => resolve((request.result as T[]) || [])
  })
}

export async function listConversationsFromDB(): Promise<Conversation[]> {
  const conversations = await listRecords<Conversation>('conversations')
  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listRunsFromDB(conversationId: string): Promise<GenerationRun[]> {
  const [runs, history, references] = await Promise.all([
    listRecords<GenerationRun>('generationRuns'),
    listRecords<ImageHistoryItem>('imageHistory'),
    listRecords<ReferenceImage>('referenceImages')
  ])
  const referenceById = new Map(references.map((reference) => [reference.id, reference]))
  return runs
    .filter((run) => run.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((run) => ({
      ...run,
      referenceImages: run.referenceImages.map((reference) => referenceById.get(reference.id) || reference),
      items: history
        .filter((item) => item.runId === run.id)
        .sort((a, b) => (a.requestIndex ?? 0) - (b.requestIndex ?? 0))
        .map((item) => ({
          ...item,
          referenceImages: item.referenceImages.map((reference) => referenceById.get(reference.id) || reference)
        }))
    }))
}

export async function findImageBlobByHistoryId(historyId: string): Promise<WebImageBlobRecord | null> {
  const db = await openWebDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('imageBlobs', 'readonly')
    const request = tx.objectStore('imageBlobs').index('historyId').get(historyId)
    request.onerror = () => reject(request.error || new Error('读取图片数据失败。'))
    request.onsuccess = () => resolve((request.result as WebImageBlobRecord | undefined) || null)
  })
}

export async function findReferenceBlobByReferenceId(referenceImageId: string): Promise<WebReferenceBlobRecord | null> {
  const db = await openWebDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('referenceImageBlobs', 'readonly')
    const request = tx.objectStore('referenceImageBlobs').index('referenceImageId').get(referenceImageId)
    request.onerror = () => reject(request.error || new Error('读取参考图数据失败。'))
    request.onsuccess = () => resolve((request.result as WebReferenceBlobRecord | undefined) || null)
  })
}
