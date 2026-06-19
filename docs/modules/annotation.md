# 图片标注窗口

标注窗口支持选择本地图片、使用 Konva 绘制和编辑标注、管理属性，并导出同名的
PNG 和 JSON 文件。

## 多云上传

上传时按当前 `cloud.targetMode` 逐个处理启用云端，并返回
`MultiCloudOperationResult`。标注上传不会改变原任务状态，也不会写入普通任务历史。

如果原图属于某个任务，系统使用该任务在对应云端锁定的 Prefix 和上传相对路径：

```text
{destinationPrefix}/{date}/{weldFolder}/{relativeImageBase}_annotation.png
{destinationPrefix}/{date}/{weldFolder}/{relativeImageBase}_annotation.json
```

例如：

```text
upload/2026-06-18/04-39-04/camera1/0001_annotation.png
upload/2026-06-18/04-39-04/camera1/0001_annotation.json
```

如果原图不属于任务，则使用当前云端配置的 Prefix：

```text
{providerPrefix}/{imageBaseName}_annotation.png
{providerPrefix}/{imageBaseName}_annotation.json
```

如果原图匹配多个任务目录，仓储层选择路径最长的任务，避免父目录误匹配。IPC 通道
仍名为 `annotation:upload-oss`，这是兼容保留的历史名称，实际已支持阿里、腾讯和
双云模式。
