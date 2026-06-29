# 设置总览

设置页采用自动保存模式。用户修改表单后，前端会延迟约 600ms 调用 `settings:save`，主进程把对应 section 写入 SQLite。

## 默认设置

核心默认值来自 `src/shared/constants.ts`。

| 分类 | 字段 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 扫描 | `directories` | `[]` | 兼容旧全局扫描目录；新配置使用 Profile 监控目录 |
| 扫描 | `intervalSeconds` | `30` | 自动扫描间隔 |
| 扫描 | `workDirNamePattern` | `^\\d{2}-\\d{2}-\\d{2}$` | 自动识别的工作次目录名正则 |
| 稳定性 | `checkIntervalMs` | `5000` | 目录稳定性检查间隔 |
| 稳定性 | `checkCount` | `2` | 连续稳定次数 |
| 上传 | `maxConcurrentTasks` | `4` | 最大并发任务 |
| 上传 | `maxFilesPerTask` | `12` | 单任务文件并发 |
| 上传 | `maxConcurrentUploads` | `24` | 全局上传文件并发 |
| 上传 | `multipartThreshold` | `100 MB` | 分片上传阈值 |
| 上传 | `startAfterTime` | `20:30` | 默认开始时间 |
| 上传 | `endBeforeTime` | `23:59` | 默认结束时间 |
| 云端 | `targetMode` | `aliyun` | 兼容旧全局上传目标；新任务使用 Profile 目标 |
| Profile | `profiles` | 默认项目 | 项目级扫描、过滤和路径规则 |
| Profile | `activeProfileId` | `default` | 默认 Profile |
| 过滤 | `suffixes` | `.jpg .jpeg .png .bmp .csv .json .log .txt` | 默认上传后缀 |
| 清理 | `enabled` | `false` | 默认不开启自动清理 |
| 清理 | `retentionDays` | `7` | 默认保留天数 |
| 数采 | `enabled` | `false` | 默认不开启数采模式 |

## 项目 Profile

新增任务的上传目标由项目 Profile 决定。每个 Profile 包含：

- 是否启用。
- 上传目标：仅阿里、仅腾讯或双云。
- 文件过滤规则，目前界面支持配置后缀。
- 阿里和腾讯各自的监控目录。
- 阿里和腾讯各自的 Prefix、路径模式、保留末级数量和对象 Key 模板。

默认 Profile 会从旧全局设置归一化生成：旧 `cloud.targetMode`、全局扫描目录、全局过滤
规则、阿里 Prefix 和腾讯 Prefix 会进入“默认项目”。`activeProfileId` 无效或指向停用
Profile 时，会回退到第一个启用 Profile。

自动扫描只读取启用 Profile 的监控目录。保存 `profiles` 或 `activeProfileId` 后，主进程
会重启扫描器 watcher，使新增或移除的 Profile 目录立即参与监听。

手动添加目录时会先选择 Profile 并预览对象 Key；SSH 机器也会保存一个 Profile 绑定。
任务创建后会保存 Profile 快照，后续修改 Profile 只影响新任务。

## 扫描配置

Profile 监控目录应填写日期目录的父级数据根目录。例如：

```text
/data/upload-root
```

如果采集程序生成：

```text
/data/upload-root/2026-06-18/04-39-04
```

系统启动后只自动扫描当天的一级 `YYYY-MM-DD` 日期目录，并将其中匹配
`workDirNamePattern` 的直接子目录作为工作次任务。默认只匹配 `04-39-04` 这类
`HH-MM-SS` 名称。

不匹配的直接子目录会显示为“已忽略目录”，例如 `teach`。用户点击“恢复监控”后，
该目录会绕过正则并作为普通任务上传。

旧日期目录不会自动发现新任务；需要补传历史数据时，应使用“手动添加目录”选择具体
工作次目录并选择 Profile。旧全局扫描配置如果直接指向日期目录，读取时会自动转换为
其父目录，并作为默认 Profile 的兼容来源。

## 上传配置

建议按机器和网络能力调整：

| 环境 | 建议 |
| --- | --- |
| 本地测试 | 任务并发 `1-2`，单任务文件并发 `2-4` |
| 千兆内网到对象存储 | 任务并发 `3-5`，全局并发 `20-50` |
| 弱网或共享网络 | 任务并发 `1-2`，全局并发 `5-10` |
| 大文件为主 | 降低文件并发，提高分片阈值前先压测 |

时间窗口只限制新任务启动，不中断正在上传中的任务。

Profile 上传目标有三种选择：

- 仅阿里云
- 仅腾讯云 TurboS3
- 同时上传阿里云和腾讯云

任务创建时会保存所选 Profile 的目标模式、两个 Prefix、路径模式和对象 Key 模板。双云
任务必须两端都成功才允许日期封账和自动清理。

阿里和腾讯的 Endpoint、Region、Bucket、AK/SK 仍是全局云端凭据；Prefix 和对象路径
规则在 Profile 中按云端配置。腾讯云使用 S3 兼容配置，TLS 证书校验默认开启，不安全
TLS 开关只用于现场自签名证书。

## 对象路径模式

每个 Profile 的每个云端可选择：

| 模式 | 行为 |
| --- | --- |
| `target-root` | 直接上传到该云端 Prefix 下 |
| `date-workdir` | 追加 `日期/工作次` |
| `keep-source` | 追加相对扫描根的源路径 |
| `last-segments` | 追加源路径末 N 级 |
| `template` | 使用对象 Key 模板渲染完整相对 Key |

模板支持 `{profile}`、`{provider}`、`{date}`、`{workDir}`、`{relativePath}`、`{filename}`、
`{stem}`、`{ext}` 等变量。模板和渲染结果不能为空，不能是绝对路径，也不能包含 `..`
路径段。上传前如果同一云端出现重复对象 Key，任务会失败并提示重复 Key，避免静默覆盖。

## 文件过滤

过滤优先级：

```text
白名单 > 黑名单 > 正则排除 > 后缀匹配
```

白名单和黑名单支持：

- 完整文件名：`result.csv`
- 后缀：`.jpg`
- 简单通配符：`data_*.csv`

正则示例：

```text
.*\/debug\/.*
.*\.tmp$
```

旧任务没有 Profile 快照时会回退全局过滤规则；新任务使用创建时保存的 Profile 过滤
规则，后续修改 Profile 不影响已创建任务。

## 数采模式

启用后，扫描器注册新目录时会尝试读取：

```text
welding_state/weld_signal.csv
```

如果存在，就提取焊接信号、相机、机器人状态等元信息并展示在任务面板。

## 自动清理

启用自动清理前请确认所有选定云端的上传结果已经可以作为可靠归档。清理会优先删除已封账日期目录，也会处理符合条件的独立 local/rsync 任务；手动添加的文件夹不会被自动删除。
