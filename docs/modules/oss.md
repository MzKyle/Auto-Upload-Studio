# 双云上传服务

## 职责

上传层由统一的 `CloudUploadService` 调度两个适配器：

- `OSSUploadService`：阿里云 OSS
- `TencentS3UploadService`：腾讯云 TurboS3/CFS 的 S3 兼容接口

执行器不直接依赖具体 SDK，并统一完成：

- 读取 OSS 配置并创建 client
- 测试 Bucket 可访问性
- 普通文件流式上传
- 大文件分片上传
- Buffer 上传，用于 SFTP 直传和标注结果
- 任务级 client 创建和取消

## 上传模式与完成规则

设置支持 `aliyun`、`tencent`、`both`。任务创建时锁定目标模式和两端 Prefix，后续修改设置只影响新任务。

双云模式下，每个文件和任务分别保存两端状态；两端都成功后逻辑文件和任务才完成。部分失败时重试只处理失败云端，成功端不会重传。

## 阿里云连接配置

需要的字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `region` | 是 | OSS Region，例如 `oss-cn-hangzhou` |
| `bucket` | 是 | Bucket 名称 |
| `accessKeyId` | 是 | AccessKey ID |
| `accessKeySecret` | 是 | AccessKey Secret |
| `endpoint` | 否 | 自定义 Endpoint，可为空 |
| `prefix` | 否 | 对象前缀，不参与 client 创建 |

连接测试会创建一个临时 client，并执行：

```text
list({ max-keys: 1 })
```

只有返回 2xx HTTP 状态码才视为成功。

## 上传路径规则

普通任务上传的 OSS key 形态：

```text
{ossPrefix}/{folderName}/{relativePath}
```

示例：

```text
upload/2026-06-18/04-39-04/camera1/001.jpg
```

实现中会把 Windows 反斜杠统一替换为 `/`，保证 OSS 对象路径稳定。

腾讯与阿里分别使用自己的 Prefix，但都追加相同的 `日期/焊接目录/文件相对路径`。

## 腾讯云 TurboS3

腾讯配置包括 Endpoint、Region、Bucket、Prefix、AccessKey ID、AccessKey Secret 和“不安全 TLS”开关。

- 使用 AWS SDK v3、S3 V4 签名和 path-style 请求。
- 默认验证 TLS 证书。
- 仅当现场服务使用无法验证的自签名证书时开启“不安全 TLS”；该设置只作用于腾讯客户端。
- 不内置参考脚本中的 Bucket、用户 ID 映射或明文凭据。

## 普通上传与分片上传

默认分片阈值是：

```text
100 MB
```

| 文件大小 | 上传方式 |
| --- | --- |
| 小于等于阈值 | `client.put(key, createReadStream(filePath))` |
| 大于阈值 | `client.multipartUpload(key, filePath, options)` |

分片上传会根据文件大小动态计算 `partSize`，避免超过 OSS 最大分片数量 `10000`。最小分片大小为 `1 MB`，最终按 `1 MB` 向上取整。

## 任务级 client

每个上传任务会调用 `createTaskClient()` 创建独立 OSS client。这样某个任务暂停或取消时，调用 `cancel()` 不会影响其他正在上传的任务。

## Buffer 上传

`uploadBuffer(buffer, ossKey)` 用在两个场景：

- SFTP 直传：远程文件通过 SFTP 读到内存后上传
- 标注上传：本地导出的 PNG 和 JSON 读成 Buffer 后上传

SFTP 和标注上传遵循当前上传模式并返回分云结果，但不写入任务历史。

## 常见失败原因

- Endpoint 和 Region 不匹配
- Bucket 名称错误
- AK/SK 没有 Bucket 读写权限
- 网络或 DNS 不通
- 上传时间过长导致连接超时
- OSS 限流返回 `429`
- 文件上传过程中被删除或被占用
