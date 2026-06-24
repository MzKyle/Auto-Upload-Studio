# 状态模型

## 逻辑任务与云端目标

逻辑任务和每个云端目标都使用：

```text
pending / scanning / uploading / completed / failed / paused
```

逻辑状态由选定云端状态聚合：

- 所有目标完成：`completed`
- 任一目标失败：`failed`
- 否则按暂停、上传、扫描、等待的优先级聚合

双云部分失败后，成功目标保持 `completed`，失败目标保持 `failed`。从阿里或腾讯
标签页重试时，`task:retry` 携带 `provider`，只重置对应目标。

## 文件状态

逻辑文件和 `task_file_destinations` 使用：

```text
pending / uploading / completed / failed
```

逻辑文件必须在所有选定云端完成后才是 `completed`。对象 key、分片 upload ID 和
错误保存在分云文件目标中；旧 `task_files.oss_key` 等字段为兼容保留。

## 日期汇总

| 状态 | 含义 |
| --- | --- |
| `collecting` | 当天仍可能产生数据，或没有工作次任务 |
| `processing` | 存在待稳定、排队或上传中的任务 |
| `blocked` | 至少一个任务失败或暂停 |
| `completed` | 日期已跨天且全部已发现任务完成 |
| `completed_with_skips` | 日期已跨天且全部已发现任务完成或跳过 |

旧日期不会自动发现新增目录；需要补传时手动添加具体工作次目录，补传完成后日期汇总
重新计算，必要时重写 `day_upload.json`。

## 标记文件

| 文件 | 位置 | 作用 |
| --- | --- | --- |
| `tmp_upload.json` | 工作次目录 | 扫描登记、任务模式、Prefix 和来源 |
| `process_task.json` | 工作次目录 | 逻辑状态与逐云文件状态 |
| `day_upload.json` | 日期目录 | 跨天完成汇总、子任务和逐云完成信息 |

## 时间窗口

时间窗口只限制新 `pending` 任务启动，不中断运行中任务。开始时间晚于结束时间时按
跨午夜窗口处理；两者都关闭时全天允许启动。
