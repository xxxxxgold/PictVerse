import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { prepareDataDir, resolveDataDir } from './data-path'

describe('data path resolution', () => {
  it('uses the project directory in development', () => {
    expect(resolveDataDir({
      cwd: 'E:/Go/src/PictVerse',
      packaged: false,
      exePath: 'E:/Go/src/PictVerse/node_modules/electron.exe'
    })).toBe(normalize('E:/Go/src/PictVerse/data'))
  })

  it('uses a sibling data directory for packaged Windows builds', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(resolveDataDir({
        cwd: 'E:/Go/src/PictVerse',
        packaged: true,
        exePath: 'D:/Apps/PictVerse/PictVerse.exe'
      })).toBe(normalize('D:/Apps/PictVerse-data'))
    } finally {
      platformSpy.mockRestore()
    }
  })

  it('uses the user data directory for packaged macOS builds', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    try {
      expect(resolveDataDir({
        cwd: '/Users/dev/PictVerse',
        packaged: true,
        exePath: '/Applications/PictVerse.app/Contents/MacOS/PictVerse',
        userDataPath: '/Users/dev/Library/Application Support/PictVerse'
      })).toBe(normalize('/Users/dev/Library/Application Support/PictVerse/data'))
    } finally {
      platformSpy.mockRestore()
    }
  })

  it('moves legacy packaged Windows data to the sibling directory when the target is missing', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const root = mkdtempSync(join(tmpdir(), 'pictverse-data-path-test-'))
    const installDir = join(root, 'PictVerse')
    const legacyDir = join(installDir, 'data')
    const targetDir = join(root, 'PictVerse-data')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'pictverse.sqlite'), 'legacy database')

    try {
      expect(prepareDataDir({
        cwd: 'E:/Go/src/PictVerse',
        packaged: true,
        exePath: join(installDir, 'PictVerse.exe')
      })).toBe(targetDir)
      expect(existsSync(join(targetDir, 'pictverse.sqlite'))).toBe(true)
      expect(existsSync(legacyDir)).toBe(false)
    } finally {
      platformSpy.mockRestore()
    }
  })

  it('does not overwrite an existing sibling data directory during legacy migration', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const root = mkdtempSync(join(tmpdir(), 'pictverse-data-path-test-'))
    const installDir = join(root, 'PictVerse')
    const legacyDir = join(installDir, 'data')
    const targetDir = join(root, 'PictVerse-data')
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(legacyDir, 'pictverse.sqlite'), 'legacy database')
    writeFileSync(join(targetDir, 'settings.json'), '{}')

    try {
      expect(prepareDataDir({
        cwd: 'E:/Go/src/PictVerse',
        packaged: true,
        exePath: join(installDir, 'PictVerse.exe')
      })).toBe(targetDir)
      expect(readdirSync(targetDir)).toEqual(['settings.json'])
      expect(existsSync(join(legacyDir, 'pictverse.sqlite'))).toBe(true)
    } finally {
      platformSpy.mockRestore()
    }
  })
})
