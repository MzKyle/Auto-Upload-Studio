# 目录扫描器

## 职责

`ScannerService` 负责把“配置中的数据根目录”转换成“日期目录 + 单次焊接任务”。它不会直接上传文件，而是先确认焊接子目录已经稳定，再注册任务。

核心行为：

- 定时扫描 `settings.scan.directories`
- 根目录下仅处理有效的 `YYYY-MM-DD` 日期目录
- 日期目录的直接子目录分别作为焊接任务
- 跳过以 `.` 开头的隐藏目录
- 已存在 `tmp_upload.json` 的焊接目录会走任务注册确认
- 新焊接目录进入稳定性检查队列
- 稳定后在焊接目录写入 `tmp_upload.json` 并创建任务
- 日期跨天且所有已发现焊接任务完成后写入 `day_upload.json`
- 已封账日期出现新焊接目录时自动删除总标记并重新处理
- 如果数采模式开启，同步提取数采元信息并广播给界面

## 稳定性检查

扫描器会对目录做快照，快照包含所有非隐藏子目录中的文件：

```text
relativePath -> size + mtimeMs
```

每隔 `stability.checkIntervalMs` 比较一次快照：

- 文件数量变化：不稳定
- 文件大小变化：不稳定
- 文件修改时间变化：不稳定
- 完全一致：稳定计数加一

当连续稳定次数达到 `stability.checkCount` 后，目录才会注册为任务。

默认配置：

| 配置 | 默认值 |
| --- | --- |
| 检查间隔 | `5000 ms` |
| 稳定次数 | `3` |

也就是说默认至少需要约 15 秒的稳定时间。

## 扫描状态

界面可以通过 `scanner:status` 获取：

| 字段 | 含义 |
| --- | --- |
| `running` | 扫描器是否运行 |
| `lastScanAt` | 最近一次扫描时间 |
| `nextScanAt` | 下一次计划扫描时间 |
| `watchedDirectories` | 当前配置的扫描目录 |
| `pendingStabilityChecks` | 正在等待稳定的目录 |
| `lastScanResults` | 最近扫描到的目录数量和新目录数量 |

扫描器每次扫描或稳定性进度变化后，会通过 `scanner:event` 广播状态。

## 任务注册

目录稳定后写入：

```json
{
  "version": 1,
  "createdAt": "2026-04-29T10:00:00.000Z",
  "folderPath": "/data/upload_root/batch_001",
  "metadata": {
    "source": "local"
  }
}
```

随后在 SQLite 的 `tasks` 表创建一条 `pending` 任务：

- `folder_path`：任务目录绝对路径
- `folder_name`：目录名，例如 `batch_001`
- `oss_prefix`：创建时读取的 OSS prefix
- `source_type`：自动扫描目录为 `local`

如果任务已存在，扫描器不会对同一路径重复创建新任务。升级前已完成的数据库任务或 `process_task.json` 会被信任，不主动重传。

## 注意事项

- 扫描目录应配置为“日期目录的父级数据根目录”，不是单个日期目录。
- 日期目录根部普通文件不会成为上传任务。
- 空日期目录不会写入总完成标记。
- 稳定性检查只看文件 size 和 mtime，不理解业务文件内容。
- 如果采集程序持续改写某个文件，目录会一直留在稳定性检查队列。
- 隐藏目录中的文件不会被纳入快照，也不会上传。
