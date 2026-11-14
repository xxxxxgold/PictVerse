import { describe, expect, it } from 'vitest'
import { DECRYPT_FAILURE_HINT, describeGenerateError } from './generate-error'

describe('describeGenerateError', () => {
  it('把 safeStorage 解密失败翻译成可操作提示', () => {
    const raw = new Error(
      "Error invoking remote method 'image:generate': Error: Error while decrypting the ciphertext provided to safeStorage.decryptString."
    )
    expect(describeGenerateError(raw)).toBe(DECRYPT_FAILURE_HINT)
  })

  it('去掉 IPC 包装前缀，保留真实原因', () => {
    const raw = new Error("Error invoking remote method 'image:generate': Error: connect ECONNREFUSED 127.0.0.1:9")
    expect(describeGenerateError(raw)).toBe('connect ECONNREFUSED 127.0.0.1:9')
  })

  it('普通错误原样返回', () => {
    expect(describeGenerateError(new Error('模型不支持遮罩'))).toBe('模型不支持遮罩')
  })

  it('字符串错误同样处理', () => {
    expect(describeGenerateError('  plain failure  ')).toBe('plain failure')
  })

  it('空值与未知类型返回兜底文案', () => {
    expect(describeGenerateError(new Error(''))).toBe('未知错误')
    expect(describeGenerateError(null)).toBe('未知错误')
    expect(describeGenerateError({ weird: true })).toBe('未知错误')
  })
})
