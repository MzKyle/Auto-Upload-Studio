# 云存储配置

## 上传目标

设置页支持三种模式：

- `aliyun`：仅阿里云 OSS
- `tencent`：仅腾讯云 TurboS3
- `both`：两个云端同时上传

任务创建时会保存上传模式和两个云端的 Prefix。后续修改设置只影响新任务。

## 阿里云 OSS

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| Endpoint | 否 | 自定义 OSS 服务地址，可留空由 SDK 按 Region 推导 |
| Region | 是 | 例如 `oss-cn-hangzhou` |
| Bucket | 是 | 目标 Bucket |
| Prefix | 否 | 对象统一前缀 |
| AccessKey ID | 是 | 专用 RAM 用户的访问密钥 ID |
| AccessKey Secret | 是 | 访问密钥 Secret |

连接测试使用临时 client 执行 `list({ max-keys: 1 })`。

## 腾讯云 TurboS3

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| Endpoint | 是 | S3 兼容服务地址，包含协议 |
| Region | 是 | 签名使用的 Region |
| Bucket | 是 | 目标 Bucket |
| Prefix | 否 | 对象统一前缀 |
| AccessKey ID | 是 | 腾讯云访问密钥 ID |
| AccessKey Secret | 是 | 腾讯云访问密钥 Secret |
| 不安全 TLS | 否 | 默认关闭，仅用于无法验证的自签名证书 |

腾讯客户端使用 AWS SDK v3、S3 V4 签名和 path-style 请求。连接测试执行
`ListObjectsV2`，最多请求一个对象。

## 对象路径

两个云端分别使用自己的 Prefix，但追加相同的任务路径：

```text
{providerPrefix}/{date}/{weldFolder}/{relativePath}
```

例如：

```text
upload/2026-06-18/04-39-04/camera1/0001.jpg
```

Windows 反斜杠会统一为 `/`，空路径段和重复分隔符会被清理。

## 权限建议

- 每个云端使用独立、最小权限的 AK/SK。
- 连接测试需要列举目标 Bucket 或 Prefix 的权限。
- 普通上传需要对象写入权限。
- 大文件需要初始化、上传和完成分片的权限。
- 不要在文档、测试代码、日志或安装包中写入真实凭据。

## 排查清单

- Endpoint、Region 和 Bucket 是否匹配。
- AK/SK 是否有效且拥有目标 Prefix 权限。
- 本机 DNS、代理和防火墙是否允许访问对象存储。
- 腾讯自签名证书是否确实需要“不安全 TLS”。
- 系统时间是否严重偏差。
- 大文件上传是否被代理或网络设备中断。
