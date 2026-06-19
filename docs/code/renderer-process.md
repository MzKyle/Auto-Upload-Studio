# 渲染进程代码

`src/renderer/App.tsx` 使用 HashRouter 提供任务面板、设置、历史、远程机器和标注页面。

## Dashboard

- 阿里和腾讯标签分别筛选当前提供方的任务目标。
- `TaskCard` 使用 `taskId:provider` 保存进度。
- 失败目标从当前标签页执行“重试此云端”。
- 日期汇总卡展示焊接目录、文件和字节统计。
- 页面订阅 `task:*` 与 `day-folder:event` 保持状态更新。

## Settings

设置页修改后约 600ms 自动保存，包含：

- 数据根目录、扫描间隔和稳定性检查。
- 上传目标模式、三层并发和时间窗口。
- 阿里与腾讯独立配置和连接测试。
- 腾讯不安全 TLS 开关。
- 过滤、数采、日志和自动清理。

## History

历史页按提供方查询 `task_destinations`，失败记录可只重试当前云端。已完成日期汇总
单独展示并可删除汇总记录。

## Remote 和 Annotation

远程页面触发 rsync 或 SFTP，并展示多云操作结果。标注工具栏在上传后按提供方显示
成功或失败；底层兼容 IPC 名称仍为 `annotation:upload-oss`。
