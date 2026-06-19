# 目录扫描器

## 职责

`ScannerService` 把配置的数据根目录转换为日期汇总和单次焊接上传任务：

- 根目录下只识别有效的 `YYYY-MM-DD` 日期目录。
- 日期目录中的直接非隐藏子目录分别作为焊接任务。
- 日期目录根部文件不会上传。
- 新焊接目录先进入稳定性检查，稳定后写入 `tmp_upload.json` 并创建任务。
- 已存在标记或数据库任务时执行恢复与关联检查，不重复创建任务。
- 跨天且所有已发现任务完成后写入 `day_upload.json`。
- 已封账日期出现新子目录时删除总标记，补传后重新封账。

## 稳定性检查

扫描器递归记录所有非隐藏文件的：

```text
relativePath -> size + mtimeMs
```

每隔 `stability.checkIntervalMs` 比较一次快照。文件数量、大小或修改时间变化都会
重置稳定计数；连续相同次数达到 `stability.checkCount` 后才注册任务。

默认值为 5 秒检查一次、连续 3 次稳定，即通常至少等待约 15 秒。

## 任务注册

`tmp_upload.json` 示例：

```json
{
  "version": 1,
  "createdAt": "2026-06-18T10:00:00.000Z",
  "folderPath": "/data/upload-root/2026-06-18/04-39-04",
  "metadata": {
    "source": "local",
    "dayFolderId": "day-folder-id",
    "date": "2026-06-18",
    "uploadRelativePath": "2026-06-18/04-39-04",
    "uploadTargetMode": "both",
    "destinationPrefixes": {
      "aliyun": "ali-upload/",
      "tencent": "tencent-upload/"
    }
  }
}
```

任务会保存：

- 日期汇总 ID 和 `日期/焊接目录` 上传相对路径。
- 创建时的上传模式。
- 阿里和腾讯各自的 Prefix。
- `local`、`rsync` 或 `manual` 来源信息。

## 日期汇总状态

| 状态 | 含义 |
| --- | --- |
| `collecting` | 当天仍可能产生数据，或尚无焊接子目录 |
| `processing` | 存在待稳定、排队或上传中的任务 |
| `blocked` | 至少一个任务失败或暂停 |
| `completed` | 日期已跨天且全部已发现任务完成 |

空日期目录不会写入 `day_upload.json`。升级前已完成的数据库任务或
`process_task.json` 会被信任，不主动重传。
