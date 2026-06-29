# 共享契约与 IPC

共享类型、常量和 IPC 通道位于 `src/shared/`。

## 云端与任务类型

| 类型 | 说明 |
| --- | --- |
| `CloudProvider` | `aliyun | tencent` |
| `UploadTargetMode` | `aliyun | tencent | both` |
| `UploadProfile` | 项目级扫描目录、过滤、目标云和路径规则 |
| `UploadPathMode` | `target-root | date-workdir | keep-source | last-segments | template` |
| `Task` / `TaskFile` | 逻辑任务与逻辑文件 |
| `TaskDestination` | 单个任务的某个云端状态和进度 |
| `TaskFileDestination` | 单个逻辑文件的某个云端结果 |
| `TaskProgress` | 包含 `taskId` 和 `provider` 的进度 |

## 日期与多云操作

| 类型 | 说明 |
| --- | --- |
| `DayFolderSummary` | 日期状态、子任务和文件/字节汇总 |
| `DayUploadMarker` | 日期封账文件结构 |
| `CloudOperationResult` | 单个提供方的成功、keys 或错误 |
| `MultiCloudOperationResult` | SFTP 的全部提供方结果 |

## 设置

`AppSettings` 包含：

- `profiles` 和 `activeProfileId`
- 兼容旧设置的 `cloud.targetMode`
- `oss`
- `tencentS3`
- 扫描、上传、过滤、稳定性、日志、数采和清理配置

新增设置必须同时更新类型、`DEFAULT_SETTINGS`、Profile 归一化、仓储合并逻辑和设置页。

## 辅助模块

- `cloud-upload.ts`：模式与提供方转换、逻辑状态聚合、进度 key。
- `day-folder.ts`：日期校验、汇总状态、上传路径、Profile 快照和对象 key。
- `constants.ts`：默认设置、标记文件名、任务/日期/提供方标签。
- `settings-effects.ts`：判断保存设置后是否需要重启扫描 watcher。

preload 只暴露通用 `invoke` 和事件订阅能力，文件系统、数据库和子进程副作用仍留在
主进程。
