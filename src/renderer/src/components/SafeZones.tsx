import s from './SafeZones.module.css'

/** F2：安全区参考线（换真图后检查构图） */
export function SafeZones({ kind }: { kind: 'card' | 'hero' }) {
  if (kind === 'card') {
    return (
      <div className={s.root}>
        <div className={`${s.band} ${s.title}`} style={{ top: 0, height: '10%' }}>
          <span>标题区 0–10%</span>
        </div>
        <div className={`${s.band} ${s.char}`} style={{ top: '10%', height: '48%' }}>
          <span>角色脸与上半身 10–58%</span>
        </div>
        <div className={s.faceBand} style={{ top: '22%', height: '8%' }}>
          <span>脸部中心 22–30%</span>
        </div>
        <div className={`${s.band} ${s.panel}`} style={{ top: '58%', bottom: 0 }}>
          <span>数据面板覆盖 58–100%</span>
        </div>
      </div>
    )
  }
  return (
    <div className={s.root}>
      <div className={`${s.band} ${s.title}`} style={{ top: 0, height: '8%', left: 0, right: 0 }}>
        <span>顶栏 0–8%</span>
      </div>
      <div className={`${s.band} ${s.panel}`} style={{ top: '8%', bottom: 0, left: 0, width: '45%' }}>
        <span>数据面板区 0–45%（只放虚化环境）</span>
      </div>
      <div className={`${s.band} ${s.char}`} style={{ top: '8%', bottom: 0, left: '45%', right: 0 }}>
        <span>角色 45–100%</span>
      </div>
      <div className={s.cross} style={{ left: '68%', top: '30%' }}>
        <span>脸部中心 x68% y30%</span>
      </div>
    </div>
  )
}
