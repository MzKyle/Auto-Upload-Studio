# 数据存储结构

数据库位于 Electron `userData/uploader.db`，启用 WAL、5 秒 busy timeout 和外键。

## 核心表

| 表 | 内容 |
| --- | --- |
| `day_folders` | 日期路径、状态、子目录清单、文件/字节汇总和完成时间 |
| `tasks` | 逻辑任务、上传模式、日期汇总 ID、上传相对路径和来源 |
| `task_files` | 逻辑文件、大小和聚合状态 |
| `task_destinations` | 每个任务的阿里/腾讯状态、Prefix、进度和错误 |
| `task_file_destinations` | 每个逻辑文件的逐云状态、对象 key、upload ID 和错误 |
| `ssh_machines` | SSH、目录、传输模式和最近同步时间 |
| `settings` | 各设置 section 的 JSON |

`tasks.oss_prefix`、`task_files.oss_key` 等旧字段为兼容保留。新逻辑以
`task_destinations` 和 `task_file_destinations` 为准。

## 数据库迁移

启动时会：

- 为没有目标记录的旧任务创建阿里云目标。
- 为未完成旧任务的文件创建阿里云文件目标。
- 添加上传模式、日期汇总和上传相对路径字段。
- 从本地任务路径或 rsync 远程路径推导未完成任务的日期层路径。
- 为旧远程机器补充 `transfer_mode`。

已完成旧任务不会主动重传。

## 标记文件

### `tmp_upload.json`

记录目录登记、来源、日期汇总、上传相对路径、上传模式和两个 Prefix。

### `process_task.json`

```json
{
  "version": 1,
  "taskId": "task-id",
  "status": "failed",
  "totalFiles": 2,
  "uploadedFiles": 1,
  "files": {
    "a.txt": "completed",
    "b.txt": "failed"
  },
  "uploadTargetMode": "both",
  "destinations": {
    "aliyun": {
      "status": "completed",
      "totalFiles": 2,
      "uploadedFiles": 2,
      "files": {
        "a.txt": "completed",
        "b.txt": "completed"
      },
      "error": null
    },
    "tencent": {
      "status": "failed",
      "totalFiles": 2,
      "uploadedFiles": 1,
      "files": {
        "a.txt": "completed",
        "b.txt": "failed"
      },
      "error": "upload failed"
    }
  },
  "lastUpdated": "2026-06-18T10:10:00.000Z",
  "error": "upload failed"
}
```

### `day_upload.json`

写在已跨天且完成的日期目录，包含日期汇总统计、所有子任务以及每个任务的逐云完成
信息。出现迟到目录时会删除并在补传完成后重建。

## 日志

日志默认位于 `userData/logs`。排查时可搜索 `任务失败`、提供方名称、`rsync`、
`SFTP`、`[Annotation]`、`迁移` 和 `自动清理`。
