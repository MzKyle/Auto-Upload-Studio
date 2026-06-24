- **首页**
  - [项目简介](/)

- **快速入门**
  - [环境依赖](guide/prerequisites.md)
  - [开发运行](guide/run-app.md)
  - [安装与打包](guide/package-install.md)

- **系统架构**
  - [架构总览](architecture/README.md)
  - [模块全景](architecture/module-overview.md)
  - [数据流](architecture/data-flow.md)
  - [状态模型](architecture/state-model.md)

- **模块详解**
  - [总览](modules/README.md)
  - [目录扫描器](modules/scanner.md)
  - [任务队列与上传执行](modules/task-upload.md)
  - [双云上传服务](modules/oss.md)
  - [SSH / rsync / SFTP](modules/remote-transfer.md)
  - [数采模式](modules/data-collect.md)
  - [历史、存储与清理](modules/storage-cleanup.md)

- **代码导读**
  - [代码导读索引](code/README.md)
  - [主进程代码](code/main-process.md)
  - [渲染进程代码](code/renderer-process.md)
  - [共享契约与 IPC](code/shared-contracts.md)

- **配置指南**
  - [设置总览](configuration/settings.md)
  - [云存储配置](configuration/oss-config.md)
  - [生产部署建议](configuration/production-config.md)

- **接口参考**
  - [IPC 通道](interfaces/ipc.md)

- **工作流程**
  - [本地目录上传](workflow/local-upload.md)
  - [远程机器同步](workflow/remote-sync.md)
  - [测试验收流程](workflow/testing.md)

- **日志与诊断**
  - [数据存储结构](logging/data-storage.md)
  - [故障排查 FAQ](faq/troubleshooting.md)
