# SSH / rsync / SFTP

## 远程机器模型

远程机器保存在 `ssh_machines` 表，包含 SSH 地址、用户名、认证方式、远程目录、
本地目录、带宽限制、CPU Nice、`rsync | sftp` 传输模式和最近同步时间。

SSH 测试使用 `ssh2`，默认 10 秒超时。测试成功只表示 SSH 可连接，不代表远程目录
可读或远端已安装 `rsync`。

## rsync 模式

`startRsync` 启动外部 `rsync` 进程，并使用：

- `--partial` 保留未完成文件。
- `--progress` 推送文件和速度信息。
- `--bwlimit` 控制带宽。
- 远端 `nice` 和 `ionice` 降低采集机负载。
- 密码认证时通过 `sshpass` 调用。

退出码为 0 后，IPC 层更新 `last_sync_at`，创建 `sourceType=rsync` 的普通任务并写入
`tmp_upload.json`。之后由任务队列按创建时锁定的云端模式上传。

## SFTP 模式

`sftpStreamToCloud`：

- 根据 `cloud.targetMode` 创建一个或两个 `CloudTaskUploader`。
- 递归读取远程文件，并为每个提供方构建自己的 Prefix 和对象路径。
- 返回 `MultiCloudOperationResult`，其中包含每个提供方的成功状态、keys 或错误。
- 不写入 `tasks`、`task_files` 或历史记录。

当前实现会将单个远程文件完整读入 Buffer。大文件应使用 `rsync`，让普通任务执行器
使用流式读取、分片上传和断点恢复。
