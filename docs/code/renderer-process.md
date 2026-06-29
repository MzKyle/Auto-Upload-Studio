# 渲染进程代码

`src/renderer/App.tsx` 使用 HashRouter 提供任务面板、设置、历史和远程机器页面。

## Dashboard

- 阿里和腾讯标签分别筛选当前提供方的任务目标。
- `TaskCard` 使用 `taskId:provider` 保存进度。
- 失败目标从当前标签页执行“重试此云端”。
- 日期汇总卡展示工作次目录、文件和字节统计。
- 页面订阅 `task:*` 与 `day-folder:event` 保持状态更新。

## Settings

设置页修改后约 600ms 自动保存，包含：

- 项目 Profile：扫描目录、启用状态、默认 Profile、目标云、过滤和对象路径规则。
- 扫描间隔和稳定性检查。
- 三层并发和时间窗口。
- 阿里与腾讯独立配置和连接测试。
- 腾讯不安全 TLS 开关。
- 数采、日志和自动清理。

## History

历史页按提供方查询 `task_destinations`，失败记录可只重试当前云端。已完成日期汇总
单独展示并可删除汇总记录。

## Remote

远程页面保存机器绑定 Profile，触发 rsync 或 SFTP，并展示多云操作结果。rsync 落盘后
按机器 Profile 创建普通上传任务；SFTP 按机器 Profile 直传云端但不写入普通任务历史。
