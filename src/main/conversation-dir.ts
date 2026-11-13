/** 会话图片子目录命名：`YYYY-MM-DD_<净化标题>_<短ID>` */
export function conversationDirName(conversation: { title: string; createdAt: string; id: string }): string {
  return `${localDatePrefix(conversation.createdAt)}_${sanitizeTitle(conversation.title)}_${conversation.id.slice(0, 8)}`
}

function localDatePrefix(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return 'unknown-date'
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10)
}

function sanitizeTitle(rawTitle: string): string {
  const cleaned = rawTitle
    .replace(/[<>:"/\\|?*]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  // 按码点截断，避免切出孤立代理对
  const capped = Array.from(cleaned).slice(0, 40).join('')
  return capped.replace(/[. ]+$/, '').trim() || '未命名'
}
