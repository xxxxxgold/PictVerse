/**
 * 生成失败信息的人话化处理。
 *
 * 主进程把 IPC 异常原样抛给渲染进程，形如：
 *   Error invoking remote method 'image:generate': Error: <真实原因>
 * 其中 safeStorage 解密失败属于用户可自行处理的情况（换机、换系统用户、
 * 拷贝 data/ 目录都会触发），必须提示「重新输入 Key」而不是抛出 Node 内部错误。
 */
const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/
const DECRYPT_FAILURE = /decrypting the ciphertext|safeStorage|decryptString/i

export const DECRYPT_FAILURE_HINT = 'API Key 无法解密（密钥与当前设备或系统用户绑定），请在设置中重新输入'

export function describeGenerateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const text = raw.trim()
  if (!text) return '未知错误'
  if (DECRYPT_FAILURE.test(text)) return DECRYPT_FAILURE_HINT
  const stripped = text.replace(IPC_PREFIX, '').trim()
  return stripped || '未知错误'
}
