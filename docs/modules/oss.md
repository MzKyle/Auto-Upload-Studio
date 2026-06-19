# 双云上传服务

## 统一接口

`CloudUploadService` 根据 `CloudProvider` 返回实现 `CloudTaskUploader` 的适配器：

- `OSSUploadService`：阿里云 OSS。
- `TencentS3UploadService`：腾讯云 TurboS3 S3 兼容接口。

统一接口包含文件上传、Buffer 上传、取消和释放资源。任务执行器不直接依赖具体 SDK。

## 阿里云 OSS

- 小文件使用流式 `put`。
- 大于配置阈值的文件使用 `multipartUpload`。
- 分片大小会动态增大，避免超过服务端分片数量限制。
- 连接测试执行最多列举一个对象的请求。

## 腾讯云 TurboS3

- 使用 AWS SDK v3、S3 Signature V4 和 path-style 请求。
- 小文件使用 `PutObjectCommand`。
- 大文件使用 `@aws-sdk/lib-storage` 的 `Upload`。
- 分片最小 5 MiB，并按文件大小控制在 9999 个分片以内。
- 默认验证 TLS；不安全 TLS 仅影响腾讯客户端。
- 连接测试使用 `ListObjectsV2Command`。

## 路径和完成规则

```text
{providerPrefix}/{date}/{weldFolder}/{fileRelativePath}
```

任务创建时锁定模式和 Prefix。双云文件只有两个 `TaskFileDestination` 都完成后，
逻辑文件才完成；任务同理。

## Buffer 上传

SFTP 和标注使用 Buffer 上传，并按当前模式创建一个或两个 uploader。操作返回
`MultiCloudOperationResult`，但不写入普通任务历史。
