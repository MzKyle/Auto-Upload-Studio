# 数采模式

## 作用

数采模式用于识别和展示焊接采集数据目录中的关键元信息。它不会修改或删除文件，只读取目录结构和 CSV/XML 内容，并把结果推送到任务面板。

启用位置：

```text
设置 -> 数采模式 -> 启用数采模式
```

## 识别条件

一个目录只有包含以下文件，才会被认为是数采目录：

```text
welding_state/weld_signal.csv
```

不满足条件时，`collectDataInfo` 返回 `null`。

## 提取内容

| 分类 | 读取位置 | 输出 |
| --- | --- | --- |
| 焊接信号 | `welding_state/weld_signal.csv` | 起弧/收弧微秒、可读时间、持续秒数 |
| 相机数据 | `camera*` 目录 | 图片数量、最小/最大时间戳 |
| 机器人状态 | `robot_state/joint_state.csv` | 行数 |
| 工具位姿 | `robot_state/tool_pose.csv` | 行数 |
| 标定文件 | `robot_state/calibration.csv` | 是否存在 |
| 控制指令 | `control_cmd/control_speed.csv`、`control_freq.csv` | 行数 |
| 点云 | `scan_point_cloud` | `.bin` 和 `.ply` 文件数量 |
| 深度图 | `camera_depth` | `.jpg` 和 `.ply` 文件数量 |
| 标注 XML | `annotation/segment_timestamps.xml` | 数据类型、质量类型、规格范围 |
| 总体统计 | 整个目录 | 文件数、总大小 |

## 时间解析

服务会从路径中反向查找日期：

```text
YYYY-MM-DD
```

然后把微秒时间戳转换成：

```text
YYYY-MM-DD HH:mm:ss.SSS
```

如果路径中没有日期，时间字段会保留为空或原始值。

## 缓存策略

数采结果保存在内存缓存中，最多保留 100 条。新结果会覆盖相同 `folderPath` 的旧结果。应用重启后缓存会清空，但可以通过再次扫描或手动运行数采分析重新生成。

## 使用场景

- 上传前快速确认一个单次焊接目录是否包含完整相机和焊接信号数据
- 观察采集时长和图像时间戳范围是否合理
- 在任务面板中把上传任务和业务数据质量放在一起看
- 为后续数据治理和缺陷标注提供轻量元信息
