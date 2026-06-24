# 安装与打包

## 构建

```bash
npm run build:linux
npm run build:win
npm run build:all
```

产物输出到 `dist/`。Linux 构建会处理 Electron 对应的 `better-sqlite3` 原生依赖。

## Debian / Ubuntu

应用版本为 `2.1.5`，典型安装命令：

```bash
sudo dpkg -i electron-uploader_2.1.5_amd64.deb
sudo apt-get -f install -y
```

实际文件名以 `dist/` 产物为准。

## 安装后验证

1. 启动应用并打开设置页。
2. 选择上传模式，配置并测试所有启用云端。
3. 添加包含 `YYYY-MM-DD` 日期目录的数据根目录。
4. 在当天日期目录下创建一个新的 `HH-MM-SS` 工作次目录并触发扫描。
5. 确认对象路径包含日期和工作次目录。
6. 双云模式下确认两个云端都完成后逻辑任务才完成。

## 原生模块问题

确认使用 Node.js 18+，建议 20 LTS，然后重新安装依赖：

```bash
rm -rf node_modules
npm install
npm run build:linux
```

不要为了修复构建而删除锁文件，除非明确需要重新生成依赖锁定结果。
