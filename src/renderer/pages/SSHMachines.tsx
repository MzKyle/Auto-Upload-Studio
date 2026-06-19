import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Wifi, Play, Edit2, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import {
  fetchSSHMachines,
  addSSHMachine,
  deleteSSHMachine,
  testSSHConnection,
  startRsync,
  startSftp,
} from "@/lib/ipc-client";
import type { SSHMachine, SSHMachineInput, TransferMode } from "@shared/types";

const EMPTY_FORM: SSHMachineInput = {
  name: "",
  host: "",
  port: 22,
  username: "root",
  authType: "key",
  privateKeyPath: "",
  password: "",
  remoteDir: "",
  localDir: "",
  bwLimit: 5000,
  cpuNice: 19,
  transferMode: "rsync",
  enabled: true,
};

export default function SSHMachines() {
  const [machines, setMachines] = useState<SSHMachine[]>([]);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; error?: string }>
  >({});
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<SSHMachineInput>({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const list = await fetchSSHMachines();
    setMachines(list);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleTest = useCallback(async (id: string) => {
    const result = await testSSHConnection(id);
    setTestResults((prev) => ({ ...prev, [id]: result }));
    showToast(
      result.ok ? "连接成功" : `连接失败: ${result.error}`,
      result.ok ? "success" : "error"
    );
  }, []);

  const handleTransfer = useCallback(
    async (machine: SSHMachine) => {
      try {
        if (machine.transferMode === "sftp") {
          const result = await startSftp(machine.id);
          if (result.ok) {
            showToast("SFTP 直传完成", "success");
          } else {
            const errors = result.results
              .filter((item) => !item.ok)
              .map(
                (item) =>
                  `${item.provider === "aliyun" ? "阿里云" : "腾讯云"}: ${
                    item.error || "上传失败"
                  }`
              )
              .join("；");
            showToast(`SFTP 部分失败: ${errors}`, "error");
          }
        } else {
          await startRsync(machine.id);
          showToast("rsync 拉取完成，已自动创建上传任务", "success");
        }
        load();
      } catch (err) {
        showToast(`传输失败: ${err}`, "error");
      }
    },
    [load]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteSSHMachine(id);
      showToast("已删除", "success");
      load();
    },
    [load]
  );

  const handleSubmit = useCallback(async () => {
    if (
      !formData.name ||
      !formData.host ||
      !formData.remoteDir ||
      !formData.localDir
    ) {
      showToast("请填写必要字段", "warning");
      return;
    }
    setSubmitting(true);
    try {
      await addSSHMachine(formData);
      showToast("机器已添加", "success");
      setShowForm(false);
      setFormData({ ...EMPTY_FORM });
      load();
    } catch (err) {
      showToast(`添加失败: ${err}`, "error");
    } finally {
      setSubmitting(false);
    }
  }, [formData, load]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">远程机器管理</h1>
        <Button
          size="sm"
          onClick={() => {
            setShowForm(!showForm);
            if (!showForm) setFormData({ ...EMPTY_FORM });
          }}
        >
          {showForm ? (
            <>
              <X className="h-4 w-4 mr-1" />
              取消
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" />
              添加机器
            </>
          )}
        </Button>
      </div>

      {/* 添加表单 */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">添加远程机器</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>名称</Label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, name: e.target.value }))
                  }
                  className="mt-1"
                  placeholder="如: 内网采集机1"
                />
              </div>
              <div>
                <Label>主机地址</Label>
                <Input
                  value={formData.host}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, host: e.target.value }))
                  }
                  className="mt-1"
                  placeholder="192.168.1.100"
                />
              </div>
              <div>
                <Label>端口</Label>
                <Input
                  type="number"
                  value={formData.port}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      port: Number(e.target.value),
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>用户名</Label>
                <Input
                  value={formData.username}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, username: e.target.value }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>认证方式</Label>
                <select
                  value={formData.authType}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      authType: e.target.value as "key" | "password",
                    }))
                  }
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="key">密钥认证</option>
                  <option value="password">密码认证</option>
                </select>
              </div>
              {formData.authType === "key" ? (
                <div>
                  <Label>私钥路径</Label>
                  <Input
                    value={formData.privateKeyPath || ""}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        privateKeyPath: e.target.value,
                      }))
                    }
                    className="mt-1"
                    placeholder="~/.ssh/id_rsa"
                  />
                </div>
              ) : (
                <div>
                  <Label>密码</Label>
                  <Input
                    type="password"
                    value={formData.password || ""}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        password: e.target.value,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
              )}
              <div>
                <Label>远程目录</Label>
                <Input
                  value={formData.remoteDir}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, remoteDir: e.target.value }))
                  }
                  className="mt-1"
                  placeholder="/data/collection"
                />
              </div>
              <div>
                <Label>本地目录</Label>
                <Input
                  value={formData.localDir}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, localDir: e.target.value }))
                  }
                  className="mt-1"
                  placeholder="/tmp/sync"
                />
              </div>
              <div>
                <Label>带宽限制 (KB/s)</Label>
                <Input
                  type="number"
                  value={formData.bwLimit}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      bwLimit: Number(e.target.value),
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>CPU Nice (0-19)</Label>
                <Input
                  type="number"
                  min={0}
                  max={19}
                  value={formData.cpuNice}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      cpuNice: Number(e.target.value),
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>传输模式</Label>
                <select
                  value={formData.transferMode}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      transferMode: e.target.value as TransferMode,
                    }))
                  }
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="rsync">rsync (落盘 + 自动上传)</option>
                  <option value="sftp">SFTP (直传当前云端)</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 h-9">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        enabled: e.target.checked,
                      }))
                    }
                    className="rounded"
                  />
                  <span className="text-sm">启用</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSubmit} disabled={submitting}>
                <Save className="h-4 w-4 mr-1" />
                {submitting ? "保存中..." : "保存"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {machines.length === 0 && !showForm ? (
        <div className="text-sm text-muted-foreground text-center py-12 border rounded-lg border-dashed">
          <p className="mb-2">暂无远程机器配置</p>
          <p>通过 SSH + rsync/SFTP 从内网机器拉取数据</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {machines.map((machine) => (
            <Card key={machine.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium">{machine.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {machine.username}@{machine.host}:{machine.port}
                      </div>
                    </div>
                    <Badge variant={machine.enabled ? "default" : "outline"}>
                      {machine.enabled ? "启用" : "禁用"}
                    </Badge>
                    <Badge variant="secondary">
                      {machine.authType === "key" ? "密钥认证" : "密码认证"}
                    </Badge>
                    <Badge variant="secondary">
                      {machine.transferMode === "sftp" ? "SFTP 直传" : "rsync"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {testResults[machine.id] && (
                      <span
                        className={`text-xs ${
                          testResults[machine.id].ok
                            ? "text-green-600"
                            : "text-destructive"
                        }`}
                      >
                        {testResults[machine.id].ok ? "连接成功" : "连接失败"}
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTest(machine.id)}
                    >
                      <Wifi className="h-3 w-3 mr-1" />
                      测试
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTransfer(machine)}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      {machine.transferMode === "sftp" ? "直传" : "拉取"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDelete(machine.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  远程: {machine.remoteDir} → 本地: {machine.localDir} |
                  带宽限制: {machine.bwLimit} KB/s
                  {machine.lastSyncAt && (
                    <>
                      {" "}
                      | 上次同步:{" "}
                      {new Date(machine.lastSyncAt).toLocaleString()}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
