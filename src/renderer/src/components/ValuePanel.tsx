import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { formatCost, formatTokens, formatUnit, totalTokens } from '@shared/pricing'
import type { PlatformId, UsageTokens, ValueModelRow, ValueRange, ValueReport } from '../../../main/providers/types'
import s from './ValuePanel.module.css'

/**
 * 等价 API 价值：本机记录里这段时间的用量，按官方 API 标准价折算成美元。
 * 点模型行展开：各类 tokens × 单价 = 金额。
 */
export function ValuePanel({
  report,
  rangeId,
  platform
}: {
  report: ValueReport | null
  rangeId: ValueRange['id']
  platform: PlatformId
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (!report) {
    return (
      <div className={s.box}>
        <div className={s.summary}>
          <div className="skeleton" style={{ height: 30, width: 120 }} />
          <div className="skeleton" style={{ height: 10, width: 160 }} />
        </div>
        <div className="skeleton" style={{ height: 10, width: '90%', marginTop: 12 }} />
        <div className="skeleton" style={{ height: 10, width: '70%', marginTop: 10 }} />
      </div>
    )
  }

  const range = report.ranges.find((r) => r.id === rangeId) ?? report.ranges[0]
  const max = Math.max(...range.models.map((m) => m.total), 0)
  const tokens = range.models.reduce((sum, m) => sum + totalTokens(m.tokens), 0)

  return (
    <div className={s.box}>
      <div className={s.summary}>
        <div className={s.total}>{formatCost(range.total, range.currency)}</div>
        <div className={s.meta}>
          <span>按官方 API 定价折算 · {range.label}</span>
          <span>
            {range.requests.toLocaleString('en-US')} 次请求 · {formatTokens(tokens)} tokens
            {range.unpricedTokens > 0 && <> · {formatTokens(range.unpricedTokens)} 无公开定价未计入</>}
          </span>
        </div>
      </div>

      {report.error && <div className={s.error}>{report.error}</div>}

      {range.models.length === 0 ? (
        <div className={s.empty}>这段时间没有{report.scope}。</div>
      ) : (
        <ul className={s.models}>
          {range.models.map((m) => {
            const isOpen = open === m.label
            return (
              <li key={m.label} className={`${s.model} ${isOpen ? s.open : ''}`}>
                <button className={s.row} onClick={() => setOpen(isOpen ? null : m.label)} aria-expanded={isOpen}>
                  <span className={s.chev} aria-hidden>
                    ›
                  </span>
                  <span className={s.name} title={m.model}>
                    {m.label}
                  </span>
                  <span className={s.tok}>{formatTokens(totalTokens(m.tokens))}</span>
                  <span className={`${s.cost} ${m.priced ? '' : s.unpriced}`}>{m.priced ? formatCost(m.total, range.currency) : '无公开定价'}</span>
                  <span className={s.share}>
                    <i style={{ width: `${max > 0 && m.priced ? Math.max(2, (m.total / max) * 100) : 0}%` }} />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className={s.detailWrap}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      <Breakdown m={m} platform={platform} currency={range.currency} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
      )}

      <p className={s.note}>
        统计 {report.scope}。{report.caveat}{' '}
        {platform === 'deepseek'
          ? `单价为 DeepSeek 官方价（${report.pricingCheckedAt} 核对，元 / 百万 tokens），空闲时段半价。`
          : `单价为官方标准价（${report.pricingCheckedAt} 核对），不含订阅折扣与税费。`}
      </p>
    </div>
  )
}

const LINES: { key: keyof UsageTokens; label: string; claudeLabel?: string }[] = [
  { key: 'input', label: '输入（未命中缓存）' },
  { key: 'output', label: '输出（含思考）' },
  { key: 'cacheWrite5m', label: '缓存写入', claudeLabel: '缓存写入 · 5 分钟' },
  { key: 'cacheWrite1h', label: '缓存写入 · 1 小时' },
  { key: 'cacheRead', label: '缓存读取' }
]

function Breakdown({ m, platform, currency }: { m: ValueModelRow; platform: PlatformId; currency: string }) {
  const lines = LINES.filter((l) => m.tokens[l.key] > 0)
  return (
    <div className={s.detail}>
      {m.model !== m.label.toLowerCase() && <div className={s.modelId}>{m.model}</div>}
      <div className={s.lines}>
        {lines.map((l) => (
          <div key={l.key} className={s.line}>
            <span className={s.lLabel}>{platform === 'claude' && l.claudeLabel ? l.claudeLabel : l.label}</span>
            <span className={s.lCalc}>
              {formatTokens(m.tokens[l.key])}
              {m.priced && m.unit && <> × {formatUnit(m.unit[l.key], currency)}/M</>}
            </span>
            <span className={s.lCost}>{m.priced ? formatCost(m.cost[l.key], currency) : '—'}</span>
          </div>
        ))}
        {m.cost.extra > 0 && (
          <div className={s.line}>
            <span className={s.lLabel}>网页搜索</span>
            <span className={s.lCalc}>$10 / 千次</span>
            <span className={s.lCost}>{formatCost(m.cost.extra, currency)}</span>
          </div>
        )}
      </div>
      <div className={s.foot}>
        {m.priced ? (
          <>
            {m.requests.toLocaleString('en-US')} 次请求 · 单价按最近一次请求的生效价显示
            {m.notes.map((n) => (
              <div key={n}>· {n}</div>
            ))}
          </>
        ) : (
          <>官方价目表里没有这个模型，未计入总额。可在 %APPDATA%\QuotaGirls\pricing.json 里补充价格。</>
        )}
      </div>
    </div>
  )
}
