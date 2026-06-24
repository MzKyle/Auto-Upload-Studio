# 代码导读索引

## 阅读顺序

```text
src/main/index.ts
  -> src/main/ipc/index.ts
  -> scanner / queue / task-runner
  -> cloud-upload + provider adapters
  -> task / destination / day-folder repositories
  -> preload
  -> renderer pages and stores
  -> shared types, paths and IPC channels
```

## 核心文件

| 文件 | 重点 |
| --- | --- |
| `src/main/services/scanner.service.ts` | 日期发现、稳定性和任务注册 |
| `src/main/services/task-runner.service.ts` | 分云文件作业、恢复和聚合 |
| `src/main/services/cloud-upload.service.ts` | 提供方适配入口 |
| `src/main/services/oss-upload.service.ts` | 阿里 OSS |
| `src/main/services/tencent-s3-upload.service.ts` | 腾讯 S3 V4、path-style 和 TLS |
| `src/main/db/task.repo.ts` | 逻辑任务与文件 |
| `src/main/db/task-destination.repo.ts` | 分云任务与文件 |
| `src/main/db/day-folder.repo.ts` | 日期汇总 |
| `src/renderer/pages/Dashboard.tsx` | 分云任务视图和日期汇总 |
| `src/renderer/pages/History.tsx` | 分云历史 |
| `src/renderer/pages/Settings.tsx` | 双云配置和连接测试 |
| `src/shared/cloud-upload.ts` | 模式展开和状态聚合 |
| `src/shared/day-folder.ts` | 日期与对象路径规则 |

## 主链路

```text
ScannerService
  -> DayFolderRepo + TaskRepo + TaskDestinationRepo
  -> TaskQueueService
  -> TaskRunnerService
  -> CloudUploadService
  -> OSSUploadService / TencentS3UploadService
  -> 分云状态
  -> 逻辑任务和日期汇总
```

相关文档：

- [主进程代码](main-process.md)
- [目录扫描器](../modules/scanner.md)
- [任务队列与上传执行](../modules/task-upload.md)
- [双云上传服务](../modules/oss.md)
- [渲染进程代码](renderer-process.md)
- [共享契约与 IPC](shared-contracts.md)
