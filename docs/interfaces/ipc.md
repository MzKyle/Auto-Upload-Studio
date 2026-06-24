# IPC 通道

通道常量位于 `src/shared/ipc-channels.ts`，主进程 handler 位于
`src/main/ipc/index.ts`，渲染进程调用封装位于 `src/renderer/lib/ipc-client.ts`。

## 任务与日期汇总

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `task:list` / `task:get` | invoke | 查询包含 `destinations` 的逻辑任务 |
| `task:add-folder` | invoke | 手动创建任务并锁定当前云端模式 |
| `task:pause` / `task:resume` / `task:cancel` | invoke | 控制逻辑任务 |
| `task:retry` | invoke | 接收 `taskId` 和可选 `provider`，支持单云重试 |
| `task:progress` | push | 推送 `taskId + provider` 的进度 |
| `task:destination-change` | push | 推送指定提供方状态和错误 |
| `task:status-change` | push | 推送逻辑任务状态 |
| `day-folder:list` | invoke | 查询日期汇总，可按状态过滤 |
| `day-folder:delete` | invoke | 删除日期汇总记录 |
| `day-folder:event` | push | 推送日期汇总更新 |

## 扫描与设置

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `scanner:status` / `scanner:trigger` | invoke | 获取状态或触发扫描 |
| `scanner:start` / `scanner:stop` | invoke | 控制扫描器 |
| `scanner:event` | push | 推送扫描与稳定性状态 |
| `settings:get-all` / `settings:save` | invoke | 读取或保存设置 |
| `settings:test-oss` | invoke | 测试阿里云 OSS |
| `settings:test-tencent-s3` | invoke | 测试腾讯云 TurboS3 |

## 远程与历史

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `ssh:*` | invoke | 远程机器 CRUD 和连接测试 |
| `rsync:start/stop/progress` | invoke/push | rsync 拉取与进度 |
| `sftp:start/stop/progress` | invoke/push | SFTP 多云直传与进度 |
| `history:list` | invoke | 按 `provider` 分页查询历史 |
| `history:clear` / `history:delete` | invoke | 删除历史 |

`sftp:start` 返回 `MultiCloudOperationResult`，按当前上传模式返回一个或多个云端结果。

## 其他

`disk:*` 提供磁盘用量，`data-collect:*` 提供数采分析与结果事件。所有事件订阅都应在
组件卸载时取消。
