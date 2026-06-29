# 开发运行

## 环境与启动

使用 Node.js 18+，建议 20 LTS：

```bash
npm install
npm run dev
```

安装会执行 Electron 原生依赖准备。SQLite 使用 `better-sqlite3`。

## 首次运行

1. 在设置页配置并分别测试所有启用云端的凭据。
2. 在项目 Profile 中选择仅阿里、仅腾讯或双云目标。
3. 在项目 Profile 中添加日期目录的父级扫描目录，并配置过滤和对象路径规则。
4. 本地调试可把扫描间隔设为 5 至 10 秒。
5. 根据需要关闭或配置上传时间窗口。
6. 在根目录下创建当天 `YYYY-MM-DD/HH-MM-SS/文件`。
7. 返回任务面板触发扫描；旧日期补传使用“手动添加目录”并选择 Profile。

任务面板和历史页可切换阿里/腾讯标签；失败时从对应标签页只重试当前云端。

## 常用命令

```bash
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm run preview
```

数据库位于 Electron `userData/uploader.db`，日志默认位于 `userData/logs`。启动日志会
打印实际路径。

## 调试顺序

- 没有任务：检查启用 Profile 的扫描目录、日期名是否为当天、工作次目录名是否匹配正则，以及稳定性状态。
- 任务不启动：检查时间窗口和任务并发。
- 单云失败：检查 Profile 目标云、当前提供方配置、权限和任务卡错误。
- 双云部分失败：从失败云端标签页执行单云重试。
- 远程失败：先测试 SSH，再检查 `rsync` / `sshpass` 和远程目录权限。
