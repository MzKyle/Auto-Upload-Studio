# 标注导出与上传

1. 在任务面板打开标注窗口。
2. 选择图片并编辑标注。
3. 导出本地 PNG 和同名 JSON。
4. 点击上传，按当前上传模式处理每个启用云端。

匹配到任务时，对每个提供方使用该任务锁定的 Prefix：

```text
{destinationPrefix}/{date}/{weldFolder}/{relativeImageBase}_annotation.png
{destinationPrefix}/{date}/{weldFolder}/{relativeImageBase}_annotation.json
```

未匹配任务时使用当前提供方配置 Prefix。上传结果逐云返回，不加入 `task_files`、
不修改原任务状态，也不创建普通任务历史。

失败时检查导出文件是否存在、启用云端配置和写权限，以及日志中的 `[Annotation]`。
