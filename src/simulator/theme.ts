/**
 * 设备模拟器页深色主题色板（**仅本页使用**）。
 *
 * 外层脚手架（侧栏 + TopBar + 控制面板页）仍是浅色，只有模拟器页整体转深色，
 * 所以这里的颜色不放进全局 index.css，而是集中在本文件里由 5 个组件共用——
 * 禁止再在组件内散落硬编码色值，改色只改这里一处。
 *
 * 深色算法由 SimulatorPage 那层 ConfigProvider 的 theme.darkAlgorithm 提供，
 * 本文件补的是 antd token 覆盖不到的自绘区域（卡片状态区、日志行、SN 徽章等）。
 */

/**
 * 三级明度分层（本主题的核心）：页面底 < 卡片 < 状态区/日志行，逐级提亮。
 * 层次靠这三档明度差拉开，边框只做收边、不承担分层职责——所以不要用加重边框
 * 去补层次感，那会让界面变碎。
 */

/** 页面底色（模拟器页最外层，需盖住外层脚手架的浅色内容区），最暗一档 */
export const BG_PAGE = '#22272e'
/** 卡片 / 面板底色，比页面底亮一档，让卡片能「浮」出来 */
export const BG_CARD = '#2d333b'
/** 次级面板底色：设备卡状态区、日志面板标题栏、日志行 hover / 展开态，最亮一档 */
export const BG_SUBTLE = '#373e47'
/** 边框（常规收边） */
export const BORDER = '#444c56'
/** 边框（弱化，用于行间分隔线这类不该抢眼的地方） */
export const BORDER_WEAK = '#373e47'
/** 主文字：标题、关键值 */
export const TEXT_PRIMARY = '#cdd9e5'
/** 次级文字：字段标签、说明 */
export const TEXT_SECONDARY = '#adbac7'
/** 弱化文字：时间戳、占位、禁用态 */
export const TEXT_MUTED = '#768390'

/** 深色下的主色（按钮/选中/「执行中」高亮统一用它，比 #1677ff 亮，深底上看得清） */
export const ACCENT = '#539bf5'

/**
 * 设备类型主题色（深色版）。
 * 浅色下的 #722ed1 / #13c2c2 在深底上几乎糊成一团，统一提亮并柔化一档
 * （饱和度太高在深底上会发艳）；状态区底色/边框改用同色低透明度，避免再引入一堆实色。
 */
export interface TypeTheme {
  /** 主色：色条、选中边框、按钮描边 */
  main: string
  /** 状态区底色 */
  soft: string
  /** 状态区边框 */
  softBorder: string
  /** 未选中卡片的描边：带一点类型色，光靠顶部 3px 色条区分类型太弱 */
  cardBorder: string
  /** antd Tag 的预设色名 */
  tag: string
}

export const TYPE_THEME: Record<string, TypeTheme> = {
  /** 染色仪：紫（染发/配色） */
  dyemachine: {
    main: '#b083f0',
    soft: 'rgba(176,131,240,0.16)',
    softBorder: 'rgba(176,131,240,0.32)',
    cardBorder: 'rgba(176,131,240,0.28)',
    tag: 'purple',
  },
  /** 洗头床：青（水） */
  washbed: {
    main: '#6cd8d0',
    soft: 'rgba(108,216,208,0.16)',
    softBorder: 'rgba(108,216,208,0.32)',
    cardBorder: 'rgba(108,216,208,0.28)',
    tag: 'cyan',
  },
}

/** 未知设备类型兜底：蓝 */
export const FALLBACK_TYPE_THEME: TypeTheme = {
  main: '#539bf5',
  soft: 'rgba(83,155,245,0.16)',
  softBorder: 'rgba(83,155,245,0.32)',
  cardBorder: 'rgba(83,155,245,0.28)',
  tag: 'blue',
}

export function getTypeTheme(deviceType: string): TypeTheme {
  return TYPE_THEME[deviceType] ?? FALLBACK_TYPE_THEME
}

/** 语义状态色（深色提亮版）：成功 / 警告 / 危险 / 离线置灰 */
export const SUCCESS = '#3fb950'
export const WARNING = '#e3b341'
export const DANGER = '#f85149'
/** 离线灰：色条、连接状态点在断开时用 */
export const OFFLINE = '#545d68'
