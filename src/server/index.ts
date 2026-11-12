import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { loadEnv } from './env'
import { proxyImageEdit, proxyImageGeneration, proxyPrompt, type WebGenerateImageInput } from './provider'
import type { PromptAssistInput } from '../shared/types'

const env = loadEnv()
const app = Fastify({ logger: true })
const distWebDir = resolve(process.cwd(), 'dist-web')

if (existsSync(distWebDir)) {
  void app.register(fastifyStatic, {
    root: distWebDir,
    prefix: '/'
  })
}

app.get('/api/health', async () => ({ ok: true }))

app.get('/api/config', async () => ({
  /** 不返回真实 baseURL，避免暴露内网地址到浏览器 */
  baseURL: '由服务器环境变量配置',
  apiKeyStored: Boolean(env.apiKey),
  defaultModel: env.imageModel,
  promptModel: env.promptModel,
  imageEditEnabled: env.enableImageEdit,
  promptAssistEnabled: env.enablePromptAssist,
  maxImageCount: env.maxImageCount
}))

app.post('/api/images/generations', async (request, reply) => {
  try {
    return await proxyImageGeneration(env, request.body as WebGenerateImageInput)
  } catch (error) {
    return reply.code(400).send({ error: { message: safeErrorMessage(error) } })
  }
})

app.post('/api/images/edits', async (request, reply) => {
  try {
    return await proxyImageEdit(env, request.body as WebGenerateImageInput)
  } catch (error) {
    return reply.code(400).send({ error: { message: safeErrorMessage(error) } })
  }
})

app.post('/api/responses/inspire', async (request, reply) => {
  try {
    const input = (request.body || {}) as PromptAssistInput
    const text = await proxyPrompt(env, [
      '请生成一条可直接用于图像生成的中文提示词。',
      '提示词需要包含主体、场景、构图、光线、风格、细节与氛围。',
      input.hasReferenceImages ? '当前会话包含参考图，请提示保留参考图主体和风格方向。' : '',
      '只输出提示词正文，不要解释，不要加标题。'
    ].filter(Boolean).join('\n'))
    return { text }
  } catch (error) {
    return reply.code(400).send({ error: { message: safeErrorMessage(error) } })
  }
})

app.post('/api/responses/enrich', async (request, reply) => {
  try {
    const input = (request.body || {}) as PromptAssistInput & { prompt?: string }
    const prompt = input.prompt?.trim() || ''
    if (!prompt) throw new Error('Prompt is required.')
    const text = await proxyPrompt(env, [
      '请丰富并优化下面的图像生成提示词。',
      '保持用户原意和核心主体不变，跟随原提示词语言输出。',
      '补充视觉细节、镜头/构图、材质、光影、风格描述。',
      input.hasReferenceImages ? '当前会话包含参考图，请保留参考图主体和风格方向。' : '',
      '只输出优化后的提示词正文，不要解释，不要加标题。',
      '',
      prompt
    ].filter((line) => line !== '').join('\n'))
    return { text }
  } catch (error) {
    return reply.code(400).send({ error: { message: safeErrorMessage(error) } })
  }
})

app.setNotFoundHandler((request, reply) => {
  if (request.method === 'GET' && !request.url.startsWith('/api/') && existsSync(join(distWebDir, 'index.html'))) {
    return reply.sendFile('index.html')
  }
  return reply.code(404).send({ error: { message: 'Not Found' } })
})

void app.listen({ port: env.port, host: '0.0.0.0' })

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/Bearer\s+[\w.-]+/g, 'Bearer ***')
  return '请求处理失败。'
}
