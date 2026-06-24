# 模块全景

## 主进程

| 模块 | 职责 |
| --- | --- |
| `database.ts` | 建表、WAL、外键和旧数据迁移 |
| `day-folder.repo.ts` | 日期汇总、子任务统计和完成查询 |
| `task.repo.ts` | 逻辑任务与逻辑文件 |
| `task-destination.repo.ts` | 分云任务、分云文件、进度与重试 |
| `scanner.service.ts` | 当天日期发现、工作次识别、忽略目录登记、任务注册和封账 |
| `task-queue.service.ts` | 时间窗口和任务并发 |
| `task-runner.service.ts` | 过滤、分云上传、恢复和标记文件 |
| `cloud-upload.service.ts` | 上传提供方适配入口 |
| `oss-upload.service.ts` | 阿里 OSS 普通、分片和 Buffer 上传 |
| `tencent-s3-upload.service.ts` | 腾讯 S3 V4、path-style、分片和 TLS 策略 |
| `ssh-rsync.service.ts` | SSH、rsync 和 SFTP 多云直传 |
| `cleanup.service.ts` | 日期目录和独立任务目录清理 |

## 渲染进程

| 模块 | 职责 |
| --- | --- |
| `Dashboard` | 分云标签、日期汇总、任务控制和扫描入口 |
| `TaskCard` | 当前提供方进度、错误和指定云端重试 |
| `History` | 分提供方历史与日期汇总 |
| `Settings` | 上传模式、双云连接测试和自动保存 |
| `SSHMachines` | 远程机器配置与传输 |

## 共享模块

- `cloud-upload.ts`：上传模式展开、逐云状态聚合和进度 key。
- `day-folder.ts`：日期名校验、汇总状态、上传相对路径和对象 key。
- `types.ts`：逻辑任务、分云目标、日期汇总和多云操作结果。
- `ipc-channels.ts`：主进程和渲染进程共享的通道常量。

扩展新的对象存储时，应实现 `CloudTaskUploader`，接入 `CloudUploadService`，并为任务
目标类型、设置、迁移、UI 标签和测试补齐对应分支。
