import { useEffect, useState, useCallback } from "react";
import { TestTube, Plus, X, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/stores/settings.store";
import { testOSS, testTencentS3, selectFolder } from "@/lib/ipc-client";
import { showToast } from "@/components/ui/toast";
import type { AppSettings } from "@shared/types";

export default function Settings() {
  const { settings, loading, loadSettings, saveSettings } = useSettingsStore();
  const [local, setLocal] = useState<AppSettings>(settings);
  const [ossTestResult, setOssTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);
  const [tencentTestResult, setTencentTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [suffixInput, setSuffixInput] = useState("");

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  useEffect(() => {
    if (loading) return;

    const localSnapshot = JSON.stringify(local);
    const settingsSnapshot = JSON.stringify(settings);

    if (localSnapshot === settingsSnapshot) {
      return;
    }

    setAutoSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        await saveSettings(local);
        setAutoSaveState("saved");
        setLastSavedAt(
          new Date().toLocaleTimeString("zh-CN", { hour12: false })
        );
      } catch (err) {
        setAutoSaveState("error");
        showToast(`自动保存失败: ${err}`, "error");
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [local, settings, loading, saveSettings]);

  const handleTestOSS = useCallback(async () => {
    setOssTestResult(null);
    const result = await testOSS(local.oss);
    setOssTestResult(result);
  }, [local.oss]);

  const handleTestTencent = useCallback(async () => {
    setTencentTestResult(null);
    const result = await testTencentS3(local.tencentS3);
    setTencentTestResult(result);
  }, [local.tencentS3]);

  const handleAddScanDir = useCallback(async () => {
    const dir = await selectFolder();
    if (dir && !local.scan.directories.includes(dir)) {
      setLocal((prev) => ({
        ...prev,
        scan: { ...prev.scan, directories: [...prev.scan.directories, dir] },
      }));
    }
  }, [local.scan.directories]);

  const handleRemoveScanDir = useCallback((dir: string) => {
    setLocal((prev) => ({
      ...prev,
      scan: {
        ...prev.scan,
        directories: prev.scan.directories.filter((d) => d !== dir),
      },
    }));
  }, []);

  const handleAddSuffix = useCallback(() => {
    const s = suffixInput.trim();
    if (!s) return;
    const suffix = s.startsWith(".") ? s : `.${s}`;
    if (!local.filter.suffixes.includes(suffix)) {
      setLocal((prev) => ({
        ...prev,
        filter: { ...prev.filter, suffixes: [...prev.filter.suffixes, suffix] },
      }));
    }
    setSuffixInput("");
  }, [suffixInput, local.filter.suffixes]);

  const handleRemoveSuffix = useCallback((suffix: string) => {
    setLocal((prev) => ({
      ...prev,
      filter: {
        ...prev.filter,
        suffixes: prev.filter.suffixes.filter((s) => s !== suffix),
      },
    }));
  }, []);

  const handleSelectLogDir = useCallback(async () => {
    const dir = await selectFolder();
    if (dir) {
      setLocal((p) => ({ ...p, log: { ...p.log, directory: dir } }));
    }
  }, []);

  if (loading)
    return <div className="p-6 text-muted-foreground">加载中...</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">设置</h1>
        <div className="text-sm text-muted-foreground">
          {autoSaveState === "saving" && "自动保存中..."}
          {autoSaveState === "saved" &&
            (lastSavedAt ? `已自动保存 ${lastSavedAt}` : "已自动保存")}
          {autoSaveState === "error" && "自动保存失败"}
        </div>
      </div>

      {/* 扫描配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">扫描配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>数据根目录</Label>
            <p className="text-xs text-muted-foreground mt-1">
              根目录下仅自动扫描当天 YYYY-MM-DD 日期目录；旧日期需要手动添加具体工作次目录
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {local.scan.directories.map((dir) => (
                <Badge key={dir} variant="secondary" className="gap-1 pr-1">
                  {dir}
                  <button
                    onClick={() => handleRemoveScanDir(dir)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button variant="outline" size="sm" onClick={handleAddScanDir}>
                <Plus className="h-3 w-3 mr-1" />
                添加目录
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>扫描间隔 (秒)</Label>
              <Input
                type="number"
                min={5}
                value={local.scan.intervalSeconds}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    scan: {
                      ...p.scan,
                      intervalSeconds: Number(e.target.value),
                    },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div className="col-span-2">
              <Label>工作次目录正则</Label>
              <Input
                value={local.scan.workDirNamePattern || "^\\d{2}-\\d{2}-\\d{2}$"}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    scan: {
                      ...p.scan,
                      workDirNamePattern: e.target.value,
                    },
                  }))
                }
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                只自动上传匹配该规则的当天工作次目录；默认匹配 20-46-05 这类目录
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>稳定性检查次数</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={local.stability.checkCount}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    stability: {
                      ...p.stability,
                      checkCount: Number(e.target.value),
                    },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label>检查间隔 (秒)</Label>
              <Input
                type="number"
                min={1}
                max={300}
                value={Math.round(local.stability.checkIntervalMs / 1000)}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    stability: {
                      ...p.stability,
                      checkIntervalMs: Number(e.target.value) * 1000,
                    },
                  }))
                }
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                每次检查间隔，总等待 = 次数 x 间隔
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 数采模式 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">数采模式</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={local.dataCollect.enabled}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  dataCollect: { ...p.dataCollect, enabled: e.target.checked },
                }))
              }
              className="rounded"
            />
            <Label>
              启用数采模式（自动对含焊接数据的文件夹提取元信息并展示）
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* 自动清理 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">自动清理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={local.cleanup.enabled}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  cleanup: { ...p.cleanup, enabled: e.target.checked },
                }))
              }
              className="rounded"
            />
            <Label>启用自动清理（按保留天数自动删除已上传的本地文件夹）</Label>
          </div>
          <div>
            <Label>保留天数（0 表示上传完成后尽快删除）</Label>
            <Input
              type="number"
              min={0}
              max={365}
              value={local.cleanup.retentionDays}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  cleanup: {
                    ...p.cleanup,
                    retentionDays: Number(e.target.value),
                  },
                }))
              }
              className="mt-1 w-32"
              disabled={!local.cleanup.enabled}
            />
            <p className="text-xs text-muted-foreground mt-1">
              仅清理自动扫描和 rsync 同步的文件夹，手动添加的不会被清理
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 上传配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">上传配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>上传目标</Label>
            <select
              value={local.cloud.targetMode}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  cloud: {
                    ...p.cloud,
                    targetMode: e.target.value as AppSettings["cloud"]["targetMode"],
                  },
                }))
              }
              className="mt-1 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="aliyun">仅上传阿里云</option>
              <option value="tencent">仅上传腾讯云</option>
              <option value="both">同时上传阿里云和腾讯云</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              只影响之后创建的任务；已有任务保持创建时的上传目标
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <div>
              <Label>最大并发任务数</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={local.upload.maxConcurrentTasks}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    upload: {
                      ...p.upload,
                      maxConcurrentTasks: Number(e.target.value),
                    },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label>单任务并发文件数</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={local.upload.maxFilesPerTask}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    upload: {
                      ...p.upload,
                      maxFilesPerTask: Number(e.target.value),
                    },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label>全局并发上传数</Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={local.upload.maxConcurrentUploads}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    upload: {
                      ...p.upload,
                      maxConcurrentUploads: Number(e.target.value),
                    },
                  }))
                }
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                跨任务全局上限
              </p>
            </div>
            <div>
              <Label>开始上传时间</Label>
              <div className="mt-1 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={local.upload.startAfterTime !== null}
                    onChange={(e) =>
                      setLocal((p) => ({
                        ...p,
                        upload: {
                          ...p.upload,
                          startAfterTime: e.target.checked
                            ? p.upload.startAfterTime ?? "20:30"
                            : null,
                        },
                      }))
                    }
                  />
                  <span>启用开始时间</span>
                </label>
                <Input
                  type="time"
                  value={local.upload.startAfterTime ?? "20:30"}
                  disabled={local.upload.startAfterTime === null}
                  onChange={(e) =>
                    setLocal((p) => ({
                      ...p,
                      upload: {
                        ...p.upload,
                        startAfterTime: e.target.value || "20:30",
                      },
                    }))
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                关闭后等价于“不设置”，开始时间不限制
              </p>
            </div>
            <div>
              <Label>结束上传时间</Label>
              <div className="mt-1 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={local.upload.endBeforeTime !== null}
                    onChange={(e) =>
                      setLocal((p) => ({
                        ...p,
                        upload: {
                          ...p.upload,
                          endBeforeTime: e.target.checked
                            ? p.upload.endBeforeTime ?? "23:59"
                            : null,
                        },
                      }))
                    }
                  />
                  <span>启用结束时间</span>
                </label>
                <Input
                  type="time"
                  value={local.upload.endBeforeTime ?? "23:59"}
                  disabled={local.upload.endBeforeTime === null}
                  onChange={(e) =>
                    setLocal((p) => ({
                      ...p,
                      upload: {
                        ...p.upload,
                        endBeforeTime: e.target.value || "23:59",
                      },
                    }))
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                关闭后等价于“不设置”，仅影响新任务启动，不中断进行中任务
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* OSS 配置 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">阿里云 OSS</CardTitle>
            <div className="flex items-center gap-2">
              {ossTestResult && (
                <span
                  className={`text-xs ${
                    ossTestResult.ok ? "text-green-600" : "text-destructive"
                  }`}
                >
                  {ossTestResult.ok
                    ? "连接成功"
                    : `失败: ${ossTestResult.error}`}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleTestOSS}>
                <TestTube className="h-3 w-3 mr-1" />
                测试连接
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Endpoint</Label>
              <Input
                value={local.oss.endpoint}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    oss: { ...p.oss, endpoint: e.target.value },
                  }))
                }
                className="mt-1"
                placeholder="oss-cn-hangzhou.aliyuncs.com"
              />
            </div>
            <div>
              <Label>Region</Label>
              <Input
                value={local.oss.region}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    oss: { ...p.oss, region: e.target.value },
                  }))
                }
                className="mt-1"
                placeholder="oss-cn-hangzhou"
              />
            </div>
            <div>
              <Label>Bucket</Label>
              <Input
                value={local.oss.bucket}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    oss: { ...p.oss, bucket: e.target.value },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label>前缀 (Prefix)</Label>
              <Input
                value={local.oss.prefix}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    oss: { ...p.oss, prefix: e.target.value },
                  }))
                }
                className="mt-1"
                placeholder="upload/"
              />
            </div>
            <div>
              <Label>AccessKey ID</Label>
              <Input
                value={local.oss.accessKeyId}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    oss: { ...p.oss, accessKeyId: e.target.value },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label>AccessKey Secret</Label>
              <Input
                type="password"
                value={local.oss.accessKeySecret}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    oss: { ...p.oss, accessKeySecret: e.target.value },
                  }))
                }
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 腾讯云 TurboS3 配置 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">腾讯云 TurboS3</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                S3 兼容接口，使用 V4 签名和 path-style 请求
              </p>
            </div>
            <div className="flex items-center gap-2">
              {tencentTestResult && (
                <span
                  className={`text-xs ${
                    tencentTestResult.ok ? "text-green-600" : "text-destructive"
                  }`}
                >
                  {tencentTestResult.ok
                    ? "连接成功"
                    : `失败: ${tencentTestResult.error}`}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleTestTencent}>
                <TestTube className="h-3 w-3 mr-1" />
                测试连接
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Endpoint</Label>
              <Input
                value={local.tencentS3.endpoint}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    tencentS3: { ...p.tencentS3, endpoint: e.target.value },
                  }))
                }
                className="mt-1"
                placeholder="https://turbos3.tencentcfs.com"
              />
            </div>
            <div>
              <Label>Region</Label>
              <Input
                value={local.tencentS3.region}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    tencentS3: { ...p.tencentS3, region: e.target.value },
                  }))
                }
                className="mt-1"
                placeholder="us-east-1"
              />
            </div>
            <div>
              <Label>Bucket</Label>
              <Input
                value={local.tencentS3.bucket}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    tencentS3: { ...p.tencentS3, bucket: e.target.value },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label>前缀 (Prefix)</Label>
              <Input
                value={local.tencentS3.prefix}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    tencentS3: { ...p.tencentS3, prefix: e.target.value },
                  }))
                }
                className="mt-1"
                placeholder="upload/<user-id>/"
              />
            </div>
            <div>
              <Label>AccessKey ID</Label>
              <Input
                value={local.tencentS3.accessKeyId}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    tencentS3: { ...p.tencentS3, accessKeyId: e.target.value },
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label>AccessKey Secret</Label>
              <Input
                type="password"
                value={local.tencentS3.accessKeySecret}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    tencentS3: {
                      ...p.tencentS3,
                      accessKeySecret: e.target.value,
                    },
                  }))
                }
                className="mt-1"
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={local.tencentS3.allowInsecureTls}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  tencentS3: {
                    ...p.tencentS3,
                    allowInsecureTls: e.target.checked,
                  },
                }))
              }
              className="rounded mt-0.5"
            />
            <span>
              允许不安全 TLS（仅在现场 TurboS3 使用无法验证的自签名证书时开启）
            </span>
          </label>
        </CardContent>
      </Card>

      {/* 文件过滤规则 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">文件过滤规则</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>后缀过滤 (标签)</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {local.filter.suffixes.map((s) => (
                <Badge key={s} variant="secondary" className="gap-1 pr-1">
                  {s}
                  <button
                    onClick={() => handleRemoveSuffix(s)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                value={suffixInput}
                onChange={(e) => setSuffixInput(e.target.value)}
                placeholder="输入后缀如 .jpg"
                className="w-40"
                onKeyDown={(e) => e.key === "Enter" && handleAddSuffix()}
              />
              <Button variant="outline" size="sm" onClick={handleAddSuffix}>
                添加
              </Button>
            </div>
          </div>
          <div>
            <Label>白名单 (每行一个文件名或模式，优先级最高)</Label>
            <textarea
              className="mt-1 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={local.filter.whitelist.join("\n")}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  filter: {
                    ...p.filter,
                    whitelist: e.target.value.split("\n").filter(Boolean),
                  },
                }))
              }
            />
          </div>
          <div>
            <Label>黑名单 (每行一个文件名或模式)</Label>
            <textarea
              className="mt-1 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={local.filter.blacklist.join("\n")}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  filter: {
                    ...p.filter,
                    blacklist: e.target.value.split("\n").filter(Boolean),
                  },
                }))
              }
            />
          </div>
          <div>
            <Label>正则表达式 (每行一个)</Label>
            <textarea
              className="mt-1 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={local.filter.regex.join("\n")}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  filter: {
                    ...p.filter,
                    regex: e.target.value.split("\n").filter(Boolean),
                  },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Webhook */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook 通知</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={local.webhook.enabled}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  webhook: { ...p.webhook, enabled: e.target.checked },
                }))
              }
              className="rounded"
            />
            <Label>启用 Webhook</Label>
          </div>
          <div>
            <Label>URL</Label>
            <Input
              value={local.webhook.url}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  webhook: { ...p.webhook, url: e.target.value },
                }))
              }
              className="mt-1"
              placeholder="https://example.com/webhook"
            />
          </div>
        </CardContent>
      </Card>

      {/* 日志配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">日志配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>日志目录 (留空使用默认目录)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={local.log.directory}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    log: { ...p.log, directory: e.target.value },
                  }))
                }
                placeholder="默认: 应用数据目录/logs"
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleSelectLogDir}>
                <FolderOpen className="h-3 w-3 mr-1" />
                选择
              </Button>
            </div>
          </div>
          <div>
            <Label>日志保留天数</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={local.log.maxDays}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  log: { ...p.log, maxDays: Number(e.target.value) },
                }))
              }
              className="mt-1 w-32"
            />
          </div>
        </CardContent>
      </Card>

      {/* 快捷键 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">快捷键</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <Label>切换窗口快捷键</Label>
            <Input
              value={local.hotkey}
              onChange={(e) =>
                setLocal((p) => ({ ...p, hotkey: e.target.value }))
              }
              className="mt-1 w-64"
              placeholder="CommandOrControl+Shift+U"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
