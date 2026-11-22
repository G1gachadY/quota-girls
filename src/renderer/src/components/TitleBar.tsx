import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { IconClose, IconGear, IconMax, IconMin, IconRefresh, IconRestore, IconWidget } from './Icons'
import s from './TitleBar.module.css'

/** 自绘标题栏（可拖动）。left 为左侧内容（总览：品牌；详情：返回 + 平台切换） */
export function TitleBar({
  left,
  refreshing,
  onRefresh,
  onSettings,
  transparent
}: {
  left: ReactNode
  refreshing: boolean
  onRefresh: () => void
  onSettings: () => void
  transparent?: boolean
}) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    api.win.isMaximized().then(setMaximized)
    return api.win.onMaximized(setMaximized)
  }, [])

  return (
    <header className={`${s.bar} ${transparent ? s.transparent : ''}`} onDoubleClick={() => api.win.toggleMaximize()}>
      <div className={s.left}>{left}</div>
      <div className={s.actions} onDoubleClick={(e) => e.stopPropagation()}>
        <button className={s.iconBtn} title="迷你挂件" onClick={() => api.mini.toggle()}>
          <IconWidget />
        </button>
        <button className={`${s.iconBtn} ${refreshing ? s.spinning : ''}`} title="立即刷新" onClick={onRefresh}>
          <IconRefresh />
        </button>
        <button className={s.iconBtn} title="设置" onClick={onSettings}>
          <IconGear />
        </button>
        <span className={s.sep} />
        <button className={s.winBtn} title="最小化" onClick={() => api.win.minimize()}>
          <IconMin />
        </button>
        <button className={s.winBtn} title={maximized ? '还原' : '最大化'} onClick={() => api.win.toggleMaximize()}>
          {maximized ? <IconRestore /> : <IconMax />}
        </button>
        <button className={`${s.winBtn} ${s.close}`} title="关闭" onClick={() => api.win.close()}>
          <IconClose />
        </button>
      </div>
    </header>
  )
}

export function Brand() {
  return (
    <div className={s.brand}>
      <svg width="20" height="20" viewBox="0 0 20 20" className={s.logo}>
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="#D97757" strokeWidth="2.4" strokeDasharray="12.6 28" strokeDashoffset="0" />
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="#10A37F" strokeWidth="2.4" strokeDasharray="12.6 28" strokeDashoffset="-13.6" />
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="#4285F4" strokeWidth="2.4" strokeDasharray="12.6 28" strokeDashoffset="-27.2" />
        <circle cx="10" cy="10" r="1.8" fill="#F3E6D3" />
      </svg>
      <span className={s.cn}>额度娘</span>
      <span className={s.en}>QUOTA GIRLS</span>
    </div>
  )
}
