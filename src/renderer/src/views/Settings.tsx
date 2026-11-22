import { motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { PLATFORM_IDS, PLATFORM_META, formatAgo } from '@shared/quota'
import type { AppSettings, AppState, ArtState, PlatformId, RawEntry } from '../../../main/providers/types'
import { api, isMock } from '../api'
import { IconChevron, IconClose, IconFolder, IconImage, IconRefresh } from '../components/Icons'
import { PlatformIcon } from '../components/PlatformIcon'
import { SOURCE_LABELS } from '../model'
import s from './Settings.module.css'

const SOURCE_OPTIONS: Record<PlatformId, { value: string; label: string }[]> = {
  claude: [
    { value: 'auto', label: '自动（OAuth → 网页）' },
    { value: 'oauth', label: 'OAuth（Claude Code 登录）' },
    { value: 'web', label: '网页登录 / sessionKey' }
  ],
  codex: [
    { value: 'auto', label: '自动（API → CLI RPC → 本地日志）' },
    { value: 'api', label: 'API（~/.codex/auth.json）' },
    { value: 'rpc', label: 'CLI RPC（codex app-server）' },
    { value: 'local-log', label: '本地会话日志（离线）' }
  ],
  antigravity: [{ value: 'auto', label: '本地 Language Server（需 Antigravity 运行）' }]
}

const STATUS_LABEL: Record<string, string> = {
  ok: '已连接',
  stale: '数据过期',
  offline: '未运行',
  auth_expired: '登录过期',
  not_configured: '未连接',
  error: '出错',
  loading: '读取中'
}

export function SettingsDrawer({
  state,
  art,
  focus,
  onClose
}: {
  state: AppState
  art: ArtState
  focus: PlatformId | null
  onClose: () => void
}) {
  const settings = state.settings
  const set = (patch: Partial<AppSettings>) => void api.setSettings(patch)
  const refs = useRef<Record<string, HTMLElement | null>>({})
  useEffect(() => {
    if (focus) refs.current[focus]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus])

  return (
    <>
      <motion.div
        className={s.backdrop}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className={s.drawer}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      >
        <header className={s.head}>
          <div>
            <div className="deco">SETTINGS</div>
            <div className={s.title}>设置</div>
          </div>
          <button className={s.close} onClick={onClose} title="关闭（Esc）">
            <IconClose />
          </button>
        </header>

        <div className={s.body}>
          {isMock && <div className={s.mock}>浏览器预览模式：显示的是假数据，设置不会保存。</div>}

          <Group title="平台连接" en="PLATFORMS">
            {PLATFORM_IDS.map((p) => (
              <div key={p} ref={(el) => (refs.current[p] = el)}>
                <PlatformBlock p={p} state={state} art={art} />
              </div>
            ))}
          </Group>

          <Group title="刷新与显示" en="GENERAL">
            <Row label="刷新间隔" hint="最小 2 分钟；遇到 429/5xx 自动指数退避（最长 30 分钟）">
              <select
                className={s.select}
                value={settings.refreshMinutes}
                onChange={(e) => set({ refreshMinutes: Number(e.target.value) })}
              >
                {[2, 3, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} 分钟
                  </option>
                ))}
              </select>
            </Row>
            <Row label="数值显示">
              <Seg
                value={settings.displayMode}
                options={[
                  { value: 'remaining', label: '剩余' },
                  { value: 'used', label: '已用' }
                ]}
                onChange={(v) => set({ displayMode: v as AppSettings['displayMode'] })}
              />
            </Row>
            <Row label="文案风格" hint={settings.copyStyle === 'game' ? '体力 / 后回满' : '剩余额度 / 后重置'}>
              <Seg
                value={settings.copyStyle}
                options={[
                  { value: 'game', label: '游戏化' },
                  { value: 'standard', label: '标准' }
                ]}
                onChange={(v) => set({ copyStyle: v as AppSettings['copyStyle'] })}
              />
            </Row>
            <Row label="邮箱打码" hint="界面上的账号显示为 a***@gmail.com；日志与原始响应始终打码">
              <Toggle on={settings.maskEmail} onChange={(v) => set({ maskEmail: v })} />
            </Row>
          </Group>

          <Group title="提醒" en="NOTIFICATIONS">
            <Row label="提醒阈值" hint={`剩余低于 ${settings.alertThreshold}% 时通知（每个窗口每个周期一次）`}>
              <div className={s.range}>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={settings.alertThreshold}
                  onChange={(e) => set({ alertThreshold: Number(e.target.value) })}
                />
                <span>{settings.alertThreshold}%</span>
              </div>
            </Row>
            <Row label="低额度提醒">
              <Toggle on={settings.notifyLow} onChange={(v) => set({ notifyLow: v })} />
            </Row>
            <Row label="回满提醒" hint="重置前剩余 ≤50% 的窗口回满时通知">
              <Toggle on={settings.notifyReset} onChange={(v) => set({ notifyReset: v })} />
            </Row>
          </Group>

          <Group title="窗口" en="WINDOW">
            <Row label="关闭按钮 = 最小化到托盘">
              <Toggle on={settings.closeToTray} onChange={(v) => set({ closeToTray: v })} />
            </Row>
            <Row label="开机自启" hint="仅安装版生效；启动后隐藏在托盘">
              <Toggle on={settings.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />
            </Row>
            <Row label="迷你挂件" hint="双击挂件打开主窗口">
              <button className={s.btn} onClick={() => api.mini.toggle()}>
                打开 / 关闭
              </button>
            </Row>
            <Row label="挂件置顶">
              <Toggle on={settings.miniAlwaysOnTop} onChange={(v) => set({ miniAlwaysOnTop: v })} />
            </Row>
          </Group>

          <Group title="插画" en="ARTWORK">
            <div className={s.btnRow}>
              <button className={s.btn} onClick={() => void api.openArtFolder()}>
                <IconFolder /> 打开插画文件夹
              </button>
              <button className={s.btn} onClick={() => void api.reloadArt()}>
                <IconImage /> 重新载入插画
              </button>
            </div>
            <p className={s.help}>
              每个平台一个子目录（claude / codex / antigravity）：card 竖版 1024×1536、hero 横版 1536×1024（png / webp / jpg）。可选
              avatar，以及体力紧张 / 耗尽差分 card-low、card-empty、hero-low、hero-empty——差分只画一种方向也行，另一处会自动借用。构图焦点在
              manifest.json 的 cardFocus / heroFocus / avatarFocus（及 cardLowFocus 等）里调整。保存文件后自动生效，无需重启。
            </p>
            <p className={s.help}>
              按 <kbd>F2</kbd> 显示 / 隐藏安全区参考线（标题区、角色区、脸部中心、数据面板区），换真图后用来检查构图。
            </p>
          </Group>

          <div className={s.about}>
            额度娘 Quota Girls {state.version} · 无任何遥测 · 数据只保存在本机
          </div>
        </div>
      </motion.aside>
    </>
  )
}

function PlatformBlock({ p, state, art }: { p: PlatformId; state: AppState; art: ArtState }) {
  const snap = state.snapshots[p]
  const settings = state.settings
  const accent = art[p].manifest.accent
  const refreshing = state.refreshing.includes(p)
  const [rawOpen, setRawOpen] = useState(false)
  const [raw, setRaw] = useState<RawEntry[] | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (rawOpen) api.getRaw(p).then(setRaw)
  }, [rawOpen, p, snap.fetchedAt])

  const windows = snap.windows
  const rule = settings.primaryRule[p]

  return (
    <div className={s.platform} style={{ '--accent': accent } as CSSProperties}>
      <div className={s.pHead}>
        <PlatformIcon id={p} size={18} />
        <span className={s.pName}>{PLATFORM_META[p].name}</span>
        <span className={`${s.pill} ${s[`st_${snap.status}`] ?? ''}`}>{STATUS_LABEL[snap.status] ?? snap.status}</span>
        <span className={s.pMeta}>
          {SOURCE_LABELS[snap.source] ?? snap.source} · {formatAgo(snap.fetchedAt)}
        </span>
        <button
          className={`${s.iconBtn} ${refreshing ? s.spin : ''}`}
          title="重新检查"
          onClick={() => void api.refresh(p)}
        >
          <IconRefresh />
        </button>
      </div>

      {snap.error && snap.status !== 'ok' && (
        <div className={s.err}>
          <b>{snap.error.message}</b>
          <span>{snap.error.hint}</span>
        </div>
      )}

      <Row label="数据源">
        <select
          className={s.select}
          value={settings.sources[p]}
          onChange={(e) => void api.setSettings({ sources: { ...settings.sources, [p]: e.target.value } as AppSettings['sources'] })}
        >
          {SOURCE_OPTIONS[p].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>

      <Row label="主额度">
        <select
          className={s.select}
          value={windows.some((w) => w.id === rule) ? rule : 'tightest'}
          onChange={(e) => void api.setSettings({ primaryRule: { ...settings.primaryRule, [p]: e.target.value } })}
        >
          <option value="tightest">最紧张的窗口（自动）</option>
          {windows.map((w) => (
            <option key={w.id} value={w.id}>
              固定：{w.label}
            </option>
          ))}
        </select>
      </Row>

      {p === 'claude' && (
        <div className={s.claudeBox}>
          <div className={s.btnRow}>
            <button className={s.btn} onClick={() => void api.claudeLogin()}>
              {state.claudeWebLoggedIn ? '重新登录 claude.ai' : '登录 claude.ai'}
            </button>
            {state.claudeWebLoggedIn && (
              <button className={s.btnGhost} onClick={() => void api.claudeLogout()}>
                退出网页登录
              </button>
            )}
            <span className={s.webState}>{state.claudeWebLoggedIn ? '● 网页已登录' : '○ 网页未登录'}</span>
          </div>
          <div className={s.keyRow}>
            <input
              className={s.input}
              type={showKey ? 'text' : 'password'}
              placeholder="或粘贴 sessionKey（sk-ant- 开头）"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button className={s.btnGhost} onClick={() => setShowKey((v) => !v)}>
              {showKey ? '隐藏' : '显示'}
            </button>
            <button
              className={s.btn}
              disabled={!keyInput.trim()}
              onClick={async () => {
                const r = await api.claudeSetSessionKey(keyInput)
                setKeyMsg({ ok: r.ok, text: r.message })
                if (r.ok) setKeyInput('')
              }}
            >
              保存
            </button>
          </div>
          {keyMsg && <div className={keyMsg.ok ? s.okMsg : s.errMsg}>{keyMsg.text}</div>}
          <p className={s.help}>
            登录窗口使用独立的浏览器分区，cookie 只保存在本程序里。Google 账号可能拒绝在内嵌窗口登录，可改用邮箱登录或粘贴 sessionKey（浏览器开发者工具 → Application → Cookies → claude.ai → sessionKey）。
          </p>
        </div>
      )}

      <button className={s.rawToggle} onClick={() => setRawOpen((v) => !v)}>
        <IconChevron className={rawOpen ? s.rot : ''} /> 原始响应（已脱敏）
      </button>
      {rawOpen && (
        <pre className={s.raw}>
          {raw == null
            ? '读取中…'
            : raw.length === 0
              ? '还没有请求记录，点右上角 ⟳ 重新检查。'
              : raw
                  .map((r) => `── ${r.label}${r.status != null ? ` · HTTP ${r.status}` : ''}\n${JSON.stringify(r.body, null, 2)}`)
                  .join('\n\n')}
        </pre>
      )}
    </div>
  )
}

function Group({ title, en, children }: { title: string; en: string; children: ReactNode }) {
  return (
    <section className={s.group}>
      <div className={s.gHead}>
        <span>{title}</span>
        <span className="deco">{en}</span>
      </div>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div>{label}</div>
        {hint && <div className={s.rowHint}>{hint}</div>}
      </div>
      <div className={s.rowCtl}>{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`${s.toggle} ${on ? s.toggleOn : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <i />
    </button>
  )
}

function Seg({
  value,
  options,
  onChange
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className={s.seg}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? s.segOn : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
