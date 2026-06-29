# 环境依赖

## 开发与运行

| 依赖 | 建议版本 | 用途 |
| --- | --- | --- |
| Node.js | 18+，建议 20 LTS | electron-vite、TypeScript 和测试 |
| npm | 9+ | 依赖和脚本 |
| Linux / Windows | 当前支持平台 | 运行与打包 |
| 阿里云 OSS 或腾讯 TurboS3 | 至少一个可写 Bucket | 云端归档 |
| `rsync` | 可选 | 远程拉取 |
| `sshpass` | 可选 | rsync 密码认证 |

Node.js 12 无法解析当前 TypeScript 和 `tsx` 工具链。

## 云端准备

阿里云需要 Region、Bucket、AK/SK，可选 Endpoint。腾讯云需要 Endpoint、Region、
Bucket、AK/SK；默认保持 TLS 校验。Prefix 和对象路径模式在项目 Profile 中按云端
配置；旧全局 Prefix 仅用于兼容迁移。

连接测试需要列举 Bucket 的权限，实际上传还需要对象写入和分片上传权限。两个云端
应使用彼此独立的最小权限凭据。

## 远程同步

- 本机可访问远程 SSH 端口。
- 密钥认证时私钥可读，远端已安装公钥。
- rsync 模式要求本机和远端都安装 `rsync`。
- 密码方式在 Linux 上需要 `sshpass`。
- 本地落地目录应预留足够空间。

## 数据目录

```text
/data/upload-root/
  2026-06-18/
    04-39-04/
      file.csv
```

在启用的项目 Profile 中添加 `/data/upload-root`。日期目录必须是有效 `YYYY-MM-DD`，
其直接子目录才会成为任务。
