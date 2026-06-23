/**
 * 滑动窗口速度计算器
 * 计算最近 N 秒内的平均上传速度
 */
export class SpeedCalculator {
  private samples: Array<{ time: number; bytes: number }> = []
  private windowMs: number

  constructor(windowMs = 5000) {
    this.windowMs = windowMs
  }

  addSample(totalBytes: number): void {
    const now = Date.now()
    this.samples.push({ time: now, bytes: totalBytes })
    // 清理过期样本
    const cutoff = now - this.windowMs
    this.samples = this.samples.filter((s) => s.time >= cutoff)
  }

  getSpeed(): number {
    if (this.samples.length < 2) return 0
    const now = Date.now()
    const cutoff = now - this.windowMs
    const recent = this.samples.filter((s) => s.time >= cutoff)
    if (recent.length < 2) return 0

    const first = recent[0]
    const last = recent[recent.length - 1]
    const timeDiff = (last.time - first.time) / 1000 // seconds
    if (timeDiff <= 0) return 0

    return Math.max(0, (last.bytes - first.bytes) / timeDiff)
  }

  reset(): void {
    this.samples = []
  }
}
