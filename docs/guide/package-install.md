# 安装与打包

## 构建

```bash
npm run build:linux
npm run build:win
npm run build:all
```

产物输出到 `dist/`。Linux 构建会处理 Electron 对应的 `better-sqlite3` 原生依赖。

## Debian / Ubuntu

应用版本为 `2.2.0`，典型安装命令：

```bash
sudo dpkg -i electron-uploader_2.2.0_amd64.deb
sudo apt-get -f install -y
```

实际文件名以 `dist/` 产物为准。

没有系统管理员权限时，可以直接运行或放置 Linux AppImage：

```bash
chmod +x dist/数据采集上传工具-2.2.0.AppImage
dist/数据采集上传工具-2.2.0.AppImage
```

## 安装后验证

1. 启动应用并打开设置页。
2. 配置并测试所有启用云端的凭据。
3. 在项目 Profile 中选择目标云、扫描目录、过滤规则和对象路径模式。
4. 在当天日期目录下创建一个新的 `HH-MM-SS` 工作次目录并触发扫描。
5. 确认对象路径与 Profile 的 Prefix、路径模式或模板预览一致。
6. 双云模式下确认两个云端都完成后逻辑任务才完成。

## 原生模块问题

确认使用 Node.js 18+，建议 20 LTS，然后重新安装依赖：

```bash
rm -rf node_modules
npm install
npm run build:linux
```

不要为了修复构建而删除锁文件，除非明确需要重新生成依赖锁定结果。
