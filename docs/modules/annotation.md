# 图片标注窗口

## 入口

在任务面板点击“标注”按钮，会打开独立的标注窗口。标注窗口与主任务面板分离，便于在上传任务运行时继续处理图片。

## 能力边界

标注模块基于 Konva / react-konva，提供：

- 选择本地图片
- 在画布上绘制和编辑标注
- 管理标注属性和子分段信息
- 导出 PNG 图片和 JSON 描述
- 将导出结果上传到 OSS

## 导出文件

导出时会让用户选择 PNG 保存路径。系统会同时写出：

```text
xxx.png
xxx.json
```

JSON 文件与 PNG 同目录、同 base name。

## OSS 上传路径

上传标注结果时，主进程会尝试根据原图路径查找包含它的任务。

### 原图属于任务目录

如果找到任务，标注结果跟随原图相对路径：

```text
{task.ossPrefix}/{task.folderName}/{relativeImagePathWithoutExt}_annotation.png
{task.ossPrefix}/{task.folderName}/{relativeImagePathWithoutExt}_annotation.json
```

示例：

```text
upload/2026-06-18/04-39-04/camera1/0001_annotation.png
upload/2026-06-18/04-39-04/camera1/0001_annotation.json
```

### 原图不属于任务目录

如果没有匹配任务，则使用 OSS 配置的 prefix 和原图文件名：

```text
{ossPrefix}/{imageBaseName}_annotation.png
{ossPrefix}/{imageBaseName}_annotation.json
```

## 注意事项

- 上传标注前必须配置 OSS。
- 导出的本地 PNG 和 JSON 会先写到磁盘，再读取成 Buffer 上传。
- 标注上传不改变原任务状态，也不写入 `task_files`。
- 如果原图路径匹配多个任务目录，仓储层会选择路径最长的任务，避免父目录误匹配子目录。
