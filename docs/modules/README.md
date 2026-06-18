# 模块详解总览

## 主链路模块

本软件的主链路可以拆成五个连续阶段：

```mermaid
graph LR
    Discover["目录发现"] --> Stable["稳定性检查"]
    Stable --> Task["任务注册"]
    Task --> Queue["队列调度"]
    Queue --> Upload["文件过滤与 OSS 上传"]
```

对应代码模块：

| 阶段 | 模块 | 说明 |
| --- | --- | --- |
| 目录发现 | `ScannerService` | 扫描配置目录下的子目录 |
| 稳定性检查 | `ScannerService` | 比较文件 size 和 mtime，确认目录不再写入 |
| 任务注册 | `TaskRepo` | 创建 `tasks` 记录，写入 `tmp_upload.json` |
| 队列调度 | `TaskQueueService` | 判断时间窗口和并发槽位 |
| 上传执行 | `TaskRunnerService` | 过滤文件、上传 OSS、更新进度 |

## 旁路能力

| 能力 | 模块 | 进入主链路方式 |
| --- | --- | --- |
| 手动添加文件夹 | IPC `task:add-folder` | 直接创建 `sourceType=manual` 任务 |
| rsync 拉取 | `SSHRsyncService.startRsync` | 拉取完成后创建 `sourceType=rsync` 任务 |
| SFTP 直传 | `SSHRsyncService.sftpStreamToCloud` | 不创建普通任务，按当前模式直传云端 |
| 数采分析 | `DataCollectService` | 扫描器发现目录后提取元信息并广播 |
| 图片标注 | `AnnotationApp` + IPC | 导出 PNG/JSON 并上传 OSS |
| 自动清理 | `CleanupService` | 任务完成后按保留天数删除本地目录 |

## 共享约束

- 所有持久状态以 SQLite 为准。
- 渲染进程不直接访问数据库或文件系统。
- 所有跨进程调用通过 `src/shared/ipc-channels.ts` 中的通道常量。
- 文件路径在任务创建时会规范化并去掉末尾斜杠。
- OSS key 统一转成 `/` 分隔，避免 Windows 路径影响云端对象路径。
