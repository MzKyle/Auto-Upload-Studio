# 数据流

## 自动扫描与双云上传

```mermaid
sequenceDiagram
  participant UI as Dashboard
  participant Scanner as ScannerService
  participant DB as SQLite
  participant Queue as TaskQueueService
  participant Runner as TaskRunnerService
  participant Ali as Aliyun
  participant Tencent as Tencent

  UI->>Scanner: 触发扫描
  Scanner->>Scanner: 只发现当天日期/工作次目录并登记忽略目录
  Scanner->>DB: 创建 day_folder、逻辑任务和分云目标
  Scanner->>Scanner: 写 tmp_upload.json
  Queue->>DB: 获取 pending 任务
  Queue->>Runner: 启动任务
  Runner->>DB: 注册逻辑文件和分云文件目标
  par 启用阿里云
    Runner->>Ali: 上传未完成的阿里目标
  and 启用腾讯云
    Runner->>Tencent: 上传未完成的腾讯目标
  end
  Runner->>DB: 更新逐云和逻辑状态
  Runner->>UI: 推送逐云进度与状态
  Runner->>Runner: 写 process_task.json
  Scanner->>DB: 汇总日期状态
  Scanner->>Scanner: 跨天完成后写 day_upload.json
```

双云部分失败时，成功目标保持完成；重试只重置指定提供方的失败状态。

## rsync 与 SFTP

```mermaid
flowchart LR
  Remote["远程目录"] --> Rsync["rsync"]
  Rsync --> Local["本地落地目录"]
  Local --> Task["普通上传任务"]
  Task --> Cloud["CloudUploadService"]

  Remote --> SFTP["SFTP 读取 Buffer"]
  SFTP --> Direct["按当前模式直传云端"]
```

`rsync` 进入普通任务链路，拥有 SQLite 状态、标记文件和历史。SFTP 返回逐云结果，
但不创建普通任务历史。

## 进度事件

| 事件 | 内容 |
| --- | --- |
| `task:progress` | `taskId + provider`、文件数、字节数、速度和当前文件 |
| `task:destination-change` | 指定云端的任务状态和错误 |
| `task:status-change` | 逻辑任务状态变化 |
| `day-folder:event` | 日期汇总状态和统计 |
| `scanner:event` | 扫描状态和待稳定目录 |
| `rsync:progress` / `sftp:progress` | 远程传输进度 |
