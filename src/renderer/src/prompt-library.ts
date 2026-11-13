import type { ImageQuality, ImageRatio } from '@shared/types'
import { IMAGE_QUALITIES_EXTENDED, getDefaultImageSize, getImageSizeOptions } from '@shared/image-options'

export type PromptTemplate = {
  id: string
  title: string
  category: string
  description: string
  prompt: string
  tags: string[]
  ratio: ImageRatio
  resolution: string
  quality: ImageQuality
  /** 生图模型；空字符串表示跟随当前会话的模型 */
  model: string
}

export type PromptLibraryItem = PromptTemplate

export type PromptTemplateInput = Omit<PromptTemplate, 'id'>

type LegacyPromptTemplateRecord = Partial<PromptTemplate> & {
  promptZh?: unknown
  promptEn?: unknown
  sourceLabel?: unknown
  sourceUrl?: unknown
}

export const PROMPT_TEMPLATE_ANY_MODEL = 'none'

export function createEmptyPromptTemplateInput(): PromptTemplateInput {
  return {
    title: '',
    category: '',
    description: '',
    prompt: '',
    tags: [],
    ratio: '1:1',
    resolution: getDefaultImageSize('1:1'),
    quality: 'auto',
    model: ''
  }
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'luxury-watch-ad',
    title: '奢华腕表广告',
    category: '商业海报',
    description: '适合高端品牌主视觉，强调金属、黑金配色和广告级质感。',
    prompt: '奢华腕表广告海报，深黑色影棚，镜面反射地面，腕表居中作为主视觉，强烈轮廓光，精细金属纹理，低调金色点缀，高级杂志摄影感，清晰阴影，高对比，超细节。',
    tags: ['广告', '腕表', '黑金', '高对比'],
    ratio: '1:1',
    resolution: getDefaultImageSize('1:1'),
    quality: 'high',
    model: ''
  },
  {
    id: 'minimal-product-shot',
    title: '极简产品主图',
    category: '产品摄影',
    description: '适合电商主图、独立站商品页和极简品牌展示。',
    prompt: '极简产品摄影，干净白色背景，物体下方柔和阴影，留白均衡，轻微反射，居中构图，边缘清晰，自然影棚光，真实材质，高级商业成片质感。',
    tags: ['电商', '主图', '极简', '棚拍'],
    ratio: '4:3',
    resolution: getDefaultImageSize('4:3'),
    quality: 'auto',
    model: ''
  },
  {
    id: 'neon-portrait',
    title: '霓虹肖像',
    category: '人物肖像',
    description: '适合人物海报、社媒头像和电影感氛围图。',
    prompt: '电影感人物肖像，人物处于霓虹分割光中，深色都市背景，皮肤高光有反射，发丝略被风吹动，浅景深，目光强烈，时尚编辑氛围，青蓝与洋红调色，胶片颗粒，真实皮肤质感。',
    tags: ['肖像', '霓虹', '电影感', '人像'],
    ratio: '3:4',
    resolution: getDefaultImageSize('3:4'),
    quality: 'high',
    model: ''
  },
  {
    id: 'fashion-editorial',
    title: '时尚编辑大片',
    category: '时尚编辑',
    description: '适合杂志感人物、服饰 lookbook 和高端审美展示。',
    prompt: '时尚编辑肖像，模特坐在干净的影棚布景中，姿态雕塑感强，轮廓鲜明，设计师服装，受控硬光，阴影精致，面料有光泽，低饱和配色，奢华杂志封面氛围，清晰对焦。',
    tags: ['时尚', '杂志', '编辑', '服装'],
    ratio: '3:4',
    resolution: getDefaultImageSize('3:4'),
    quality: 'high',
    model: ''
  },
  {
    id: 'sports-poster',
    title: '运动海报',
    category: '运动广告',
    description: '适合球星、运动品牌和高冲击力宣传图。',
    prompt: '运动宣传海报，运动员姿态强劲，深色影棚背景，戏剧性的侧光，光滑地面反射，轻微运动拖影，预留品牌文案区域，能量感强，超写实，高对比，电影式构图。',
    tags: ['运动', '海报', '冲击力', '品牌'],
    ratio: '16:9',
    resolution: getDefaultImageSize('16:9'),
    quality: 'high',
    model: ''
  },
  {
    id: 'storyboard-grid',
    title: '四宫格故事板',
    category: '故事板',
    description: '适合流程展示、分镜叙事和动作阶段变化。',
    prompt: '四格故事板，四个连续画面，同一角色和一致服装，故事推进清晰，背景变化简单，动作可读，分镜分隔干净，编辑式排版，带有标注感但不要真实文字，精致概念设计风格。',
    tags: ['分镜', '叙事', '多格', '流程'],
    ratio: '16:9',
    resolution: getDefaultImageSize('16:9'),
    quality: 'medium',
    model: ''
  },
  {
    id: 'sticker-sheet',
    title: '贴纸包',
    category: '贴纸包',
    description: '适合表情包、角色贴纸和社交媒体素材包。',
    prompt: '高质量贴纸页，同一个卡通角色拥有多种表情和姿势，干净白色背景，粗线条轮廓，明快颜色，可直接抠图的边缘，俏皮构图，不要额外文字，不要水印，保持统一设计语言。',
    tags: ['贴纸', '表情包', '角色', '套图'],
    ratio: '1:1',
    resolution: getDefaultImageSize('1:1'),
    quality: 'high',
    model: ''
  },
  {
    id: 'infographic-product',
    title: '产品信息图',
    category: '信息图',
    description: '适合功能说明、卖点拆解和对比海报。',
    prompt: '干净的信息图风格产品视觉，大主体产品，悬浮说明区域，简单几何结构，留白均衡，预留清晰文字区域，柔和阴影，排版精致，现代商业设计，阅读性强的构图。',
    tags: ['信息图', '卖点', '说明', '布局'],
    ratio: '3:2',
    resolution: getDefaultImageSize('3:2'),
    quality: 'medium',
    model: ''
  },
  {
    id: 'interior-mood',
    title: '空间氛围图',
    category: '空间设计',
    description: '适合室内设计、品牌空间和建筑气质展示。',
    prompt: '建筑空间氛围图，温暖自然光，多层次材质，平静构图，触感清晰的表面，现代家具，柔和阴影，精致配色，宽松取景，高级设计杂志审美。',
    tags: ['空间', '建筑', '室内', '材质'],
    ratio: '3:2',
    resolution: getDefaultImageSize('3:2'),
    quality: 'high',
    model: ''
  },
  {
    id: 'food-editorial',
    title: '美食封面',
    category: '食物摄影',
    description: '适合菜单封面、餐饮海报和食材视觉。',
    prompt: '编辑式美食摄影，近景主菜，蒸汽与纹理清晰可见，深色或暖色桌面，受控高光，诱人的色彩平衡，浅景深，精致餐厅氛围，高级杂志风格。',
    tags: ['美食', '餐饮', '食材', '封面'],
    ratio: '1:1',
    resolution: getDefaultImageSize('1:1'),
    quality: 'high',
    model: ''
  },
  {
    id: 'cinematic-poster',
    title: '电影海报',
    category: '电影封面',
    description: '适合剧情海报、概念影片和角色主视觉。',
    prompt: '电影感海报，主角剪影居中，戏剧性环境，多层光束，氛围压抑，强烈对比，电影级调色，适合放标题的构图，空气中有尘雾或烟雾，悬念感强，完成度高。',
    tags: ['电影', '海报', '概念', '角色'],
    ratio: '2:3',
    resolution: getDefaultImageSize('2:3'),
    quality: 'high',
    model: ''
  },
  {
    id: 'glass-ui-card',
    title: '玻璃态界面',
    category: 'UI 视觉',
    description: '适合产品演示、界面概念图和未来感视觉稿。',
    prompt: '未来感玻璃态 UI 卡片悬浮在空间中，透明层叠，柔和反射，低调发光，深色渐变环境，精确间距，优雅界面组件，现代产品设计 mockup，真实材质，干净构图。',
    tags: ['UI', '玻璃态', '概念', '产品'],
    ratio: '16:9',
    resolution: getDefaultImageSize('16:9'),
    quality: 'medium',
    model: ''
  },
  // —— 以下 16 条来自 ZZAI 提示词画廊（GPT Image 2.6 精选，已剥除身份参考依赖）——
  {
    id: 'airpods-infographic',
    title: 'AirPods 产品信息图',
    category: '信息图',
    description: '高端极简产品信息图：模特佩戴并展示产品，白色影棚渐变底，细指针线与四个英文卖点标签，商业摄影质感。',
    prompt: 'Create one square 1:1 high-end minimalist product infographic featuring the specific dated model branch AirPods 5 with Wireless Charging Case, selected from Apple\'s current product page checked on 2026-11-12. Show one adult woman as a generic model presenting the product; do not imply she already owns or wears it. Stage a clean commercial product demonstration: she wears a matching pair of white open-ear earbuds with short stems and holds an open glossy white wireless charging case at chest height, angled toward the viewer, with earbuds and the small case LED clearly visible. For this explanatory composite, show the worn pair and the matching pair in the open case as two separate product depictions in the same infographic; this is a visual demonstration convention, not a claim about one retail set\'s total contents. Set a crisp white-to-light-gray studio gradient with soft blue accents, soft diffused lighting, subtle reflections and gentle shadows. Keep the subject and product sharply legible, with slight background softness, balanced negative space and thin elegant pointer lines with minimal line icons. Render only these four exact English labels, each once: “Active Noise Cancellation,” “Spatial Audio,” “Long Battery Life,” and “Seamless Connectivity.” The Chinese source translations are retained as an inactive alternative set and must not appear in this default English-label image. Use clean sans-serif Apple-inspired typography without an Apple logo or claim that this is an official Apple advertisement. Aim for polished commercial-photography realism. “4K” is a visual-detail target only, not a promise of output resolution.',
    tags: ['信息图', '产品', '电商', '卖点'],
    ratio: '1:1',
    resolution: '1024x1024',
    quality: 'high',
    model: ''
  },
  {
    id: 'giant-cap-infographic',
    title: '巨型帽子产品信息图',
    category: '信息图',
    description: '超现实产品信息图：人物与近等高巨型帽子同框，精致缝线与面料质感，优雅标注线，商业广告收尾。',
    prompt: 'Create a polished, photorealistic product-infographic image in a clean studio with a soft neutral gradient. Show one adult woman standing naturally beside an oversized Nike cap. Scale the cap dramatically, almost as tall as the woman, so it is the dominant surreal product feature. She lightly holds or adjusts its brim in a relaxed, stylish interaction. Give the cap crisp stitching, visible fabric texture, clean seams, subtle realistic wear, and a sharp, correctly proportioned Nike swoosh. Use restrained contemporary streetwear coordinated with the cap, without adding unsupported claims about the person. Add elegant, sparse infographic annotation lines and one legible callout reading “Premium stitching.” Use soft studio light with controlled highlights and shadows, crisp slightly vibrant color, balanced composition, sharp focus and subtle depth of field. Aim for high detail and a clean commercial fashion-advertising finish; 4K is a visual detail target, not a resolution guarantee. Show the Nike design as requested without implying sponsorship or endorsement. Do not impose an aspect ratio absent from the source.',
    tags: ['信息图', '产品', '广告', '超现实'],
    ratio: '3:2',
    resolution: '1536x1024',
    quality: 'high',
    model: ''
  },
  {
    id: 'snack-teardown-infographic',
    title: '零食技术拆解信息图',
    category: '信息图',
    description: '白底黑线工程拆解风零食信息图：剖面结构、标注框、箭头与材质说明，琥珀色点缀，社媒方图。',
    prompt: 'Create a branded technical infographic for granola bar named Example Granola Bar, combining a clearly visible realistic product photograph or photorealistic render with technical annotations placed directly over the image. Use a pure white studio background and black ink-style architectural sketch linework, with warm amber accents. Include organized callouts for key components; an internal cross-section showing structure, layers, or design; measurements, dimensions, and specifications; material/composition callouts with quantities; arrows explaining the function of primary features and structural integrity; a simple schematic or sectional diagram of key mechanical/design elements; and a sustainability callout. Keep the callout areas present but qualitative and non-numeric, use unnumbered measurement guides, and make sustainability a neutral concept without a factual claim. Never invent ingredients, amounts, dimensions, materials, performance, or sustainability facts. Put the product name in bold inside a hand-drawn technical annotation box with an accent-color border near an upper corner. Keep the realistic product clearly visible; annotations should feel technical and architectural, precise yet slightly hand-drawn. Use warm amber for 20–30% of the annotation linework and black for 70–80%. Maintain clean composition and balanced negative space, an educational food-engineering mood, and premium branding. Add a subtle generic brand-style mark in a corner, not a fabricated real-company logo. Minimal technical illustration aesthetic; white background, black annotation lines/text, and warm amber only for accents and key callouts. Target a square 1080×1080, ultra-crisp, social-feed-ready design; exact pixel output is not guaranteed. No watermark.',
    tags: ['信息图', '拆解', '食品', '标注'],
    ratio: '1:1',
    resolution: '1024x1024',
    quality: 'medium',
    model: ''
  },
  {
    id: 'yogurt-cloud-ad',
    title: '云海草莓酸奶广告',
    category: '商业海报',
    description: '3:4 竖版超现实甜点广告：玻璃罐悬浮粉云之间，草莓酸奶质感真实，人物与云海呼应，粉彩电影感。',
    prompt: 'Create one vertical 3:4 surreal, dreamy dessert-campaign image. A large clear glass mason jar floats weightlessly in the center, filled with a thick, creamy strawberry-yogurt smoothie in soft pastel pink, with visible strawberry seeds and tiny fruit pieces. Top it with a generous whipped-yogurt swirl and one whole fresh strawberry with green leaves. Float the jar within a fluffy cotton-candy pink cloudscape, with soft pink clouds and scattered fresh strawberries drifting around it against a light-blue sky. Beside the jar, show one graceful adult woman with soft wavy blonde hair, fresh natural makeup, rosy cheeks and glossy lips, wearing a light pastel-pink summer dress. She gently smiles at the camera and holds a spoonful of creamy strawberry yogurt. A soft breeze moves her hair and dress. Keep the jar and woman both clearly visible with a believable floating relationship. Use soft glowing light, an ethereal sweet playful mood, vibrant yet gentle pastel tones and cinematic depth of field, combining realistic glass/yogurt/fruit details with whimsical fantasy. Preserve the source\'s 3:4 ratio. The source\'s --stylize 250 and --v 6 tokens are origin metadata, not current API parameters.',
    tags: ['广告', '甜点', '超现实', '粉彩'],
    ratio: '3:4',
    resolution: '768x1024',
    quality: 'high',
    model: ''
  },
  {
    id: 'pepsi-screen-pour-ad',
    title: '穿屏倒可乐广告',
    category: '商业海报',
    description: '超现实商业合成摄影：手机屏幕内人物持杯，屏幕外倒可乐，液体穿屏而过，木桌暖光，电影级广告画面。',
    prompt: 'Create a hyper-realistic surreal composite commercial photograph on a wooden tabletop. A large, oversized smartphone dominates the frame, with its screen clearly visible and creating a strong dimensional-break illusion. Inside the phone screen, show one clearly adult woman. Depict her much larger than ordinary scale in a close-up winter setting. She smiles happily and holds a clear drinking glass; make the Pepsi globe logo and the exact word “Pepsi” clearly visible on the glass.\n\nOutside the screen, show a separate cropped real human hand holding a cold bottle covered in condensation and pouring dark Pepsi cola toward the phone. Create the surreal interaction so the liquid visibly breaks through the display plane and continues into the glass held by the woman inside the screen. Keep the hand, bottle, liquid stream, screen boundary, glass and visible logo legible and visually connected. Do not add another face.\n\nPlace a closed book and a black pen beside the phone on the wooden table. Use warm natural lighting and soft cinematic shadows. Render ultra-sharp liquid splashes, hyper-real skin texture and realistic reflections on the glass and phone screen. Aim for the polished surreal cinematic-advertising look and high detail described by “8K,” without promising an actual resolution. Treat Pepsi as a visible product/logo element only; do not imply brand sponsorship or endorsement. Do not impose an aspect ratio absent from the source.',
    tags: ['广告', '超现实', '饮料', '合成'],
    ratio: '4:3',
    resolution: '1024x768',
    quality: 'high',
    model: ''
  },
  {
    id: 'cyberpunk-object-city',
    title: '四格物品微缩城市',
    category: 'UI 视觉',
    description: '2×2 四格：键盘/主板/黑胶机/手表各自化作 200 倍放大的赛博朋克微缩城市，1:500 居民与悬浮车流。',
    prompt: 'Create ONE square 1:1 image as a clear 2x2 grid, with one separate macro-city diorama in each quadrant. Use these selected text defaults, all taken from the source\'s own examples: top left, keyboard; top right, motherboard; bottom left, vinyl record player; bottom right, wristwatch. Treat each complete object as its own massive floating or elevated concrete platform in a dark environment, magnified 200x. For each object, derive four urban zones from its actual structure: the main surface, the largest prominent feature, its secondary details, and its wiring, casing, strap or outer rim. Transform the parts into hollowed, inhabited structures of concrete, neon and glass while keeping each object\'s original silhouette and recognizable layout clear from afar. For the keyboard, turn the key grid into city blocks, the spacebar into a central boulevard or market, detail keys into special districts, and its cable or rim into transit. For the motherboard, use its board surface as the urban grid, its largest component as the hub, its ports and fine components as specialized districts, and its traces or edges as transit routes. For the record player, make the spinning disc a central park or arena, the tonearm a monumental bridge, its controls special districts, and its casing or cable a transit route. For the wristwatch, make the face a grand public square, the crown a control tower, its buttons details or districts, and the strap a sweeping highway. Populate the streets between components with swarming tiny 1:500-scale citizens, shoppers and workers, and send miniature trains, hover-cars or trams along routes derived from each object\'s wiring or casing. All miniature residents are varied, anonymous, non-identifiable crowd figures. Cover every flat surface with extreme fine detail: neon signs, rooftop gardens, air-conditioning units and tiny market stalls with awnings. Preserve each source object\'s silhouette and layout so it remains instantly recognizable. Use a strict 45-degree high-angle isometric view like a city-building game. Set the scene at midnight in fine visible cyberpunk rain, with a dark, moody atmosphere and wet, highly reflective ground around the objects. Illuminate the scene entirely with diegetic city light from cyan, magenta and amber neon signs, streetlights and glowing windows within the components. Render as an ultra-detailed 3D architectural image in an Unreal Engine 5 style. The 1:500 figure scale describes the tiny inhabitants relative to their diorama; the complete output remains one square 1:1 image.',
    tags: ['微缩', '城市', '四格', '赛博朋克'],
    ratio: '1:1',
    resolution: '1024x1024',
    quality: 'high',
    model: ''
  },
  {
    id: 'notion-desk-illustration',
    title: 'Notion 风格桌面插画',
    category: 'UI 视觉',
    description: 'Notion 风格极简编辑部插画：书桌一角，扁平几何形体与大量留白，暖白/炭灰/灰绿配色，安静友好。',
    prompt: 'Create a polished Notion-inspired minimalist editorial illustration of a quiet desk corner with an open notebook, a small potted plant and a plain mug. Default subject: a quiet desk corner with an open notebook, a small potted plant and a plain mug. Use clean confident linework, simplified geometric forms, flat color fills and generous negative space. Keep the objects recognizable but intentionally simple, arranged in a balanced composition on a plain light background. Use a restrained palette of warm white, charcoal, muted sage and one soft accent color, with only subtle grounding shadows. Make it feel calm, friendly and contemporary. Avoid photorealism, 3D rendering, dense texture, copied application UI, readable text, logos, brand marks and watermark.',
    tags: ['插画', '极简', '桌面', '扁平'],
    ratio: '1:1',
    resolution: '1024x1024',
    quality: 'medium',
    model: ''
  },
  {
    id: 'ios-photos-mockup',
    title: 'iOS 相册界面样稿',
    category: 'UI 视觉',
    description: '虚构 iOS Photos 全天相册样稿：25 格缩略图从清晨排到深夜，七段服装与光线推进，界面文字仅限英文导航。',
    prompt: 'Create a fictional, full-screen iOS-style Photos album screenshot mockup: a designed image template, not a capture from an actual device or account and not a record of a real person\'s private day. Use a portrait phone-screen composition and the supported automatic canvas-ratio default; the source specifies no numeric image ratio. Recreate the requested Photos interface structure: a neutral status bar showing 9:41, signal and battery; the app label Photos; the Library title; the Today section; a dense photo grid; and bottom tabs labeled exactly Library / For You / Albums / Search. Render all interface words in English and do not add other readable text.\n\nShow a 5-by-5 grid of 25 thumbnails, ordered chronologically by row from morning to late night. This is a concrete layout default: exactly 15 of the 25 tiles are selfies or mirror selfies, and exactly 10 are solo portraits taken by someone else. The photographer and all other people stay outside every frame. Cover these selfie types: waking-up in bed, under the covers, by the pillow, bathroom mirror, elevator mirror, window-side, indoor natural-light, sofa, bedside, after-coming-home, night, close-up face, half-body, full-body mirror, and one additional relaxed candid selfie. Cover these other-photographer types: seated, standing, side-profile, looking-back, indoor hallway, window-side, candid bedside, chair, carpet, and one additional casual solo portrait. Every tile contains the same one clearly adult woman alone.\n\nEvery tile shows the same fictional adult woman with long black hair; keep her facial features, hairstyle and proportions consistent across all 25 thumbnails. Use natural, consistent fictional proportions wherever a full-body view is designed. The wardrobe and situations below are the designed scenes.\n\nKeep seven distinct chronological wardrobe blocks: morning, milky-white camisole lounge top with light-gray home shorts; late morning, fitted white short-sleeve top with a pale blue-gray pleated mini skirt; noon, black thin-strap top with high-waisted denim shorts; afternoon, light-gray knit cardigan over a white inner layer with a black mini skirt; evening, dark-gray blazer, white thin-strap top and black pleated mini skirt; night, fitted black mini dress with slim silver accessories; late night after returning home, loose white T-shirt with soft lounge shorts. Make each change visibly distinct. Let the light progress from relaxed just-woke morning, through clear late-morning daylight and ordinary afternoon outing light, to soft city evening light, dim indoor night and quiet late-night home light.\n\nKeep the overall mood quiet, private-feeling, relaxed and believable as visual storytelling, without implying a real private-life record. Use varied poses, camera distances, angles, expressions and lighting, with a credible native smartphone-camera photographic texture. Keep the interface crisp and the thumbnails dense and continuous. No other people, identity drift, fabricated thumbnail captions, or extra UI copy.',
    tags: ['UI', '界面', '样稿', '相册'],
    ratio: '9:21',
    resolution: '768x1792',
    quality: 'medium',
    model: ''
  },
  {
    id: 'vermeer-still-life',
    title: '维米尔蓝静物油画',
    category: '空间设计',
    description: '维米尔风格油画：蓝白陶器、折叠布与水果的桌面静物，柔和窗光与细腻笔触，荷兰黄金时代氛围，无人物。',
    prompt: 'Create a Vermeer-inspired oil painting with abundant Vermeer Blue, drawing on the deep mineral richness of lapis lazuli and ultramarine. As a disclosed subject default because the source specifies no subject, depict a quiet non-figurative tabletop still life: a blue-and-white ceramic vessel, a softly folded cloth and a few pieces of fruit arranged in an intimate interior. Use balanced, restrained composition, delicate tonal transitions, luminous highlights and soft natural window light falling across the objects and table. Let rich blue occupy a generous share of the image through the vessel, cloth and subtle shadow accents, balanced by warm muted ochre, cream and natural wood tones. Aim for the calm, precise, intimate atmosphere and painterly surface of a historical Dutch Golden Age interior oil painting, with visible fine brushwork and nuanced light. This is a broad stylistic homage; do not reproduce or claim to depict a specific Vermeer painting. No people, lettering, frame, watermark or modern props.',
    tags: ['油画', '静物', '古典', '蓝调'],
    ratio: '16:9',
    resolution: '1280x720',
    quality: 'high',
    model: ''
  },
  {
    id: 'character-card-knight',
    title: '角色卡·奇幻女骑士',
    category: '角色设计',
    description: '同一角色四视图角色设定表：银甲红披风女骑士，正/侧/背三视角，浅灰影棚底，中立站姿。',
    prompt: 'character reference sheet of a clearly adult female knight, front view / three-quarter view / side view / back view of the same person, identical silver plate armor and dark red cape, seamless light-grey studio background, consistent proportions and face, full body visible, neutral pose, soft even studio lighting, crisp armor detail, 16:9, one single still image containing all views side by side, no animation, clean layout, 16:9',
    tags: ['角色卡', '设定表', '奇幻', '四视图'],
    ratio: '3:4',
    resolution: '1152x1536',
    quality: 'medium',
    model: ''
  },
  {
    id: 'character-card-assassin',
    title: '角色卡·现代刺客',
    category: '角色设计',
    description: '同一角色多视图设定表：黑色战术大衣现代刺客，中灰背景，A-pose，写实面料质感。',
    prompt: 'character reference sheet of a clearly adult assassin, front / side / back views of the same person, identical black tactical coat over charcoal turtleneck, seamless mid-grey background, consistent facial features and silhouette, full body, neutral A-pose, soft studio light, realistic fabric texture, 16:9, one single still image containing all views side by side, no animation, clean layout, 16:9',
    tags: ['角色卡', '设定表', '现代', '多视图'],
    ratio: '16:9',
    resolution: '1536x864',
    quality: 'medium',
    model: ''
  },
  {
    id: 'character-card-medic',
    title: '角色卡·赛博医疗兵',
    category: '角色设计',
    description: '同一角色 turntable 设定表：白青配色赛博医疗服带橙色饰条，浅灰背景，全身三视角。',
    prompt: 'character turnaround sheet of a clearly adult cyberpunk field medic, front / three-quarter / back views of the same character, same white-and-teal med suit with orange accent panels, seamless light-grey backdrop, identical hair and face across all views, full body visible, even lighting, clean line-free photoreal rendering, 16:9, one single still image containing all views side by side, no animation, clean layout, 16:9',
    tags: ['角色卡', '设定表', '赛博朋克', '医疗'],
    ratio: '16:9',
    resolution: '1536x864',
    quality: 'medium',
    model: ''
  },
  {
    id: 'character-card-qipao',
    title: '角色卡·旗袍女侠',
    category: '角色设计',
    description: '同一角色多视图设定表：现代改良旗袍女侠，暖灰背景，发髻统一，丝绸质感细节。',
    prompt: 'character reference sheet of a clearly adult heroine in a modern fitted qipao with side slit, front / side / back views of the same woman, identical outfit and hair bun, seamless warm-grey studio background, consistent proportions, full body, neutral standing pose, soft directional studio lighting, silk texture detail, 16:9, one single still image containing all views side by side, no animation, clean layout, 16:9',
    tags: ['角色卡', '设定表', '旗袍', '多视图'],
    ratio: '3:4',
    resolution: '1152x1536',
    quality: 'medium',
    model: ''
  },
  {
    id: 'isometric-figurine',
    title: '全身等距微缩人偶',
    category: '产品摄影',
    description: '盲盒风写实收藏人偶：等距 3/4 视角，藏青开衫配米色衬衫与纸袋挥手动作，纯白底极简产品渲染。',
    prompt: 'Create one realistic full-body blind-box-style miniature collectible figurine of a generic adult person in a clean isometric three-quarter view, translating the design into believable simplified figurine features and coherent toy proportions. Keep the entire figure visible and centered from head to both feet. As the selected clothing default, dress the figure in a navy cardigan over a cream shirt, dark navy straight-leg trousers, and white sneakers; these are target design choices. As the selected action default, have the figure hold a small unbranded cream paper shopping bag in one hand and give a friendly wave with the other. Model the clothing carefully with subtle handcrafted miniature details and physically plausible materials. Place the figure alone on a pure white background with a minimal premium product-render composition, clean edges and a soft grounding shadow. Render crisp, finely resolved details and realistic materials. No extra people, text, watermark, warped anatomy, floating props or cropped feet.',
    tags: ['手办', '盲盒', '等距', '微缩'],
    ratio: '2:3',
    resolution: '1024x1536',
    quality: 'high',
    model: ''
  },
  {
    id: 'asymmetric-grid-poster',
    title: '非对称网格海报',
    category: '商业海报',
    description: '当代平面设计海报：非对称模块网格、错位对齐与强方向节奏，米白底近黑字型配朱红几何点缀。',
    prompt: 'Create a contemporary graphic-design poster centered on asymmetric grid design. As a curation-selected example theme, present a conceptual study of form and balance, not a real event or factual announcement. Use a vertical 4:5 canvas with a warm off-white ground, near-black typography and vermilion geometric accents. Build a clearly asymmetric modular grid with varied block sizes, intentional offset alignment, generous negative space and a strong directional rhythm. Place the exact headline “FORM IN MOTION” as the dominant upper-left typographic block and the exact supporting line “A study in balance” in a smaller contrasting module toward the lower-right. Add a few crisp abstract forms—one large circle, a rectangular block and a diagonal band—integrated with the grid rather than decorative clutter. Keep all wording correctly spelled, cleanly typeset and legible; include no other readable text, logos, dates or invented event details. Make the composition feel deliberate, balanced through asymmetry, print-ready and visually coherent.',
    tags: ['海报', '版式', '几何', '平面设计'],
    ratio: '3:4',
    resolution: '1152x1536',
    quality: 'high',
    model: ''
  },
  {
    id: 'felted-lockscreen',
    title: '羊毛毡锁屏播放器',
    category: 'UI 视觉',
    description: '竖版手机锁屏音乐播放器插画：整屏羊毛毡手工质感，方形封面、进度条与圆角按钮，可爱安静。',
    prompt: 'Create a vertical, front-facing smartphone lock-screen music-player illustration. Design a square album art in the upper center depicting one clearly adult woman, completely re-rendered in felted-wool and needle-felt embroidery style. The entire screen is a tactile three-dimensional handmade felt world: frame, background, album-art rendering, interface, lettering, icons, buttons and borders all use softly blended wool fibers, visible irregular fiber texture and gently softened outlines. Keep the layout flat and straight-on: square album art at the upper center; directly below it, a rounded felt music-player control panel with a song-title line reading exactly “【New beginning in 2026】”, an artist-name line reading “Unknown Artist”, a progress bar bearing the exact Japanese text “ここから、始まる”, the exact time “0:00 / -3:31”, and rounded previous, play/pause and next buttons. At the bottom place two round fluffy felt lock-screen shortcuts, flashlight on the left and camera on the right. Derive the overall background hue, brightness and mood from the album art. Outside the cover and control panel, use a subtle solid felt color, gentle gradient extracted from the cover, or a simplified abstract felt pattern; keep it quiet and subordinate to the player. Add only a few tiny soft point-light flecks and the gentle nighttime glow of a smartphone screen. Make the result cute, gentle, quiet and touchable, with clean spacing and legible required text. Use a generic unbranded lock-screen design; add no unrelated text, UI, logos or watermark.',
    tags: ['羊毛毡', '锁屏', '播放器', '手工'],
    ratio: '9:16',
    resolution: '720x1280',
    quality: 'medium',
    model: ''
  }
]

export const PROMPT_LIBRARY_STORAGE_KEY = 'pictverse.prompt-library.items.v1'
/** 内置模板集版本：追加新模板时 +1，老用户首次访问时会把缺失的内置模板合并进本地库。 */
const PROMPT_LIBRARY_SEED_VERSION = 2
const PROMPT_LIBRARY_SEED_VERSION_KEY = 'pictverse.prompt-library.seed-version'

export type PromptTemplateFilterOptions = {
  query?: string
  category?: string
  ratio?: ImageRatio | 'all'
  quality?: ImageQuality | 'all'
  /** 具体模型名，或 'all' 不过滤，或 PROMPT_TEMPLATE_ANY_MODEL 只看跟随会话的模板 */
  model?: string | 'all'
}

export function getPromptTemplateCategories(templates: PromptTemplate[] = PROMPT_TEMPLATES): string[] {
  return Array.from(new Set(templates.map((template) => template.category)))
}

/** 模板里真正用到的模型名，已去空去重排序；不含「跟随会话」。 */
export function getPromptTemplateModels(templates: PromptTemplate[] = PROMPT_TEMPLATES): string[] {
  return Array.from(new Set(templates.map((template) => template.model.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  )
}

export function filterPromptTemplates<T extends PromptTemplate = PromptTemplate>(
  templates: T[] = PROMPT_TEMPLATES as T[],
  options: PromptTemplateFilterOptions = {}
): T[] {
  const query = options.query?.trim().toLowerCase() || ''
  return templates.filter((template) => {
    if (options.category && options.category !== 'all' && template.category !== options.category) return false
    if (options.ratio && options.ratio !== 'all' && template.ratio !== options.ratio) return false
    if (options.quality && options.quality !== 'all' && template.quality !== options.quality) return false
    if (options.model && options.model !== 'all') {
      const templateModel = template.model.trim()
      if (options.model === PROMPT_TEMPLATE_ANY_MODEL) {
        if (templateModel) return false
      } else if (templateModel !== options.model) {
        return false
      }
    }
    if (!query) return true

    const haystack = [
      template.title,
      template.category,
      template.description,
      template.prompt,
      template.tags.join(' '),
      template.resolution,
      template.model
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(query)
  })
}

export function getPromptLibraryItems(): PromptLibraryItem[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(PROMPT_LIBRARY_STORAGE_KEY)
  if (!raw) {
    savePromptLibraryItems(PROMPT_TEMPLATES)
    saveSeedVersion()
    return PROMPT_TEMPLATES
  }
  let items: PromptLibraryItem[]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    items = parsed.map((item) => normalizePromptLibraryItem(item)).filter((item): item is PromptLibraryItem => item != null)
  } catch {
    return []
  }
  return mergeMissingBuiltinTemplates(items)
}

/** 种子版本升级时，把本地库里缺失的内置模板补进去（用户自建与已改动的内置条目不受影响）。 */
function mergeMissingBuiltinTemplates(items: PromptLibraryItem[]): PromptLibraryItem[] {
  if (getSeedVersion() >= PROMPT_LIBRARY_SEED_VERSION) return items
  const missing = PROMPT_TEMPLATES.filter((builtin) => !items.some((item) => item.id === builtin.id))
  saveSeedVersion()
  if (missing.length === 0) return items
  const next = [...items, ...missing]
  savePromptLibraryItems(next)
  return next
}

function getSeedVersion(): number {
  const value = Number(window.localStorage.getItem(PROMPT_LIBRARY_SEED_VERSION_KEY))
  return Number.isFinite(value) && value > 0 ? value : 1
}

function saveSeedVersion(): void {
  window.localStorage.setItem(PROMPT_LIBRARY_SEED_VERSION_KEY, String(PROMPT_LIBRARY_SEED_VERSION))
}

export function createPromptLibraryItem(input: PromptTemplateInput): PromptLibraryItem {
  const template = normalizePromptTemplate(input, createPromptTemplateId())
  if (!template) throw new Error('Invalid prompt template.')
  const next = [template, ...getPromptLibraryItems().filter((entry) => entry.id !== template.id)]
  savePromptLibraryItems(next)
  return template
}

export function updatePromptLibraryItem(id: string, input: PromptTemplateInput): PromptLibraryItem {
  const items = getPromptLibraryItems()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) throw new Error('Prompt template not found.')
  const updated = normalizePromptTemplate({ ...input, id }, id)
  if (!updated) throw new Error('Invalid prompt template.')
  const next = [...items]
  next[index] = updated
  savePromptLibraryItems(next)
  return updated
}

export function deletePromptLibraryItem(id: string): void {
  savePromptLibraryItems(getPromptLibraryItems().filter((item) => item.id !== id))
}

export function clonePromptTemplate(template: PromptTemplate): PromptTemplateInput {
  return {
    title: template.title,
    category: template.category,
    description: template.description,
    prompt: template.prompt,
    tags: [...template.tags],
    ratio: template.ratio,
    resolution: template.resolution,
    quality: template.quality,
    model: template.model
  }
}

function savePromptLibraryItems(items: PromptTemplate[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(items))
}

function normalizePromptTemplate(input: unknown, id = createPromptTemplateId()): PromptTemplate | null {
  if (!input || typeof input !== 'object') return null
  const record = input as LegacyPromptTemplateRecord
  const title = safeText(record.title)
  const category = safeText(record.category)
  const description = safeText(record.description)
  const prompt = safeText(record.prompt) || safeText(record.promptZh)
  if (!title || !category || !prompt) return null
  const ratio = isImageRatio(record.ratio) ? record.ratio : '1:1'
  const quality = isImageQuality(record.quality) ? record.quality : 'auto'
  return {
    id,
    title,
    category,
    description,
    prompt,
    tags: normalizeTags(record.tags),
    ratio,
    resolution: normalizeResolution(ratio, record.resolution),
    quality,
    model: normalizeModel(record.model)
  }
}

function normalizePromptLibraryItem(input: unknown): PromptLibraryItem | null {
  return normalizePromptTemplate(input, safeText((input as Partial<PromptTemplate> | null)?.id) || createPromptTemplateId())
}

function normalizeResolution(ratio: ImageRatio, value: unknown): string {
  const candidate = safeText(value)
  if (candidate && getImageSizeOptions(ratio).some((option) => option.value === candidate)) return candidate
  return getDefaultImageSize(ratio)
}

/** 缺失或非字符串时退回跟随会话（空字符串），不臆测模型名。 */
function normalizeModel(value: unknown): string {
  return safeText(value)
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => safeText(item)).filter(Boolean)
}

function isImageRatio(value: unknown): value is ImageRatio {
  return typeof value === 'string' && ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21'].includes(value)
}

function isImageQuality(value: unknown): value is ImageQuality {
  return typeof value === 'string' && IMAGE_QUALITIES_EXTENDED.includes(value as ImageQuality)
}

function createPromptTemplateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom-${crypto.randomUUID()}`
  }
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
