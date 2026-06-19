# 主进程代码

`src/main/index.ts` 负责初始化 SQLite、注册 IPC、创建窗口并启动扫描、队列和清理
服务。渲染进程不直接访问 Node API。

## IPC 聚合

`src/main/ipc/index.ts` 提供：

- 逻辑任务控制和带 `provider` 的重试。
- 日期汇总查询、删除和事件。
- 阿里与腾讯独立连接测试。
- rsync 任务创建和 SFTP 多云直传。
- 分提供方历史。
- 标注多云上传。

## 数据库

仓储职责：

| 仓储 | 内容 |
| --- | --- |
| `TaskRepo` | 逻辑任务、逻辑文件和路径匹配 |
| `TaskDestinationRepo` | 分云任务、分云文件、进度和错误 |
| `DayFolderRepo` | 日期汇总、子任务统计和清理查询 |
| `HistoryRepo` | 按提供方查询完成/失败目标 |
| `SettingsRepo` | 默认值合并和设置迁移 |

## 扫描与执行

`ScannerService` 只扫描数据根目录下的日期目录，再处理日期目录中的直接子目录。
稳定后注册逻辑任务和分云目标。

`TaskRunnerService` 为每个启用提供方创建独立 `CloudTaskUploader`，但所有任务共享全局
上传信号量。文件结果先写分云表，再聚合逻辑文件和任务状态。

## 上传适配器

- `OSSUploadService`：阿里云流式、分片和 Buffer 上传。
- `TencentS3UploadService`：AWS SDK v3、S3 V4、path-style、分片与 TLS 策略。
- `CloudUploadService`：配置校验和适配器选择。

## 远程与清理

rsync 成功后创建普通任务；SFTP 直接返回逐云结果。清理服务先删除已封账日期目录，
再删除符合条件且未归属日期汇总的独立 `local` / `rsync` 目录。
