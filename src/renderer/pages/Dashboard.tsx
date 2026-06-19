import { useEffect, useCallback, useState } from "react";
import { FolderPlus, RefreshCw, PlayCircle, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskCard } from "@/components/TaskCard";
import { DataCollectCard } from "@/components/DataCollectCard";
import { ScanSchedulePanel } from "@/components/ScanSchedulePanel";
import { DiskUsagePanel } from "@/components/DiskUsagePanel";
import { DayFolderCard } from "@/components/DayFolderCard";
import { useTaskStore } from "@/stores/task.store";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { showToast } from "@/components/ui/toast";
import {
  selectFolder,
  addFolder as addFolderApi,
  pauseTask,
  resumeTask,
  cancelTask,
  retryTask,
  triggerScan,
  fetchDataCollectList,
  fetchDayFolders,
  openAnnotationWindow,
} from "@/lib/ipc-client";
import { IPC } from "@shared/ipc-channels";
import type {
  CloudProvider,
  DataCollectInfo,
  DayFolderSummary,
} from "@shared/types";
import { progressKey } from "@shared/cloud-upload";

export default function Dashboard() {
  const { tasks, progress, loading, loadTasks } = useTaskStore();
  const [dataCollects, setDataCollects] = useState<DataCollectInfo[]>([]);
  const [dayFolders, setDayFolders] = useState<DayFolderSummary[]>([]);
  const [provider, setProvider] = useState<CloudProvider>("aliyun");

  useTaskProgress();

  useEffect(() => {
    loadTasks();
    fetchDataCollectList()
      .then(setDataCollects)
      .catch(() => {});
    fetchDayFolders({ limit: 30 })
      .then(setDayFolders)
      .catch(() => {});
  }, [loadTasks]);

  // 监听新的数采结果
  useEffect(() => {
    const off = window.api.on(
      IPC.DATA_COLLECT_RESULT,
      (_event: unknown, data: unknown) => {
        const info = data as DataCollectInfo;
        setDataCollects((prev) => {
          const filtered = prev.filter((d) => d.folderPath !== info.folderPath);
          const updated = [info, ...filtered];
          return updated.slice(0, 100);
        });
      }
    );
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    const off = window.api.on(
      IPC.DAY_FOLDER_EVENT,
      (_event: unknown, data: unknown) => {
        const summary = data as DayFolderSummary;
        setDayFolders((prev) => {
          const next = [summary, ...prev.filter((item) => item.id !== summary.id)];
          return next
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30);
        });
      }
    );
    return () => off();
  }, []);

  const handleAddFolder = useCallback(async () => {
    const folder = await selectFolder();
    if (folder) {
      await addFolderApi(folder);
      loadTasks();
    }
  }, [loadTasks]);

  const handleScan = useCallback(async () => {
    await triggerScan();
    await Promise.all([
      loadTasks(),
      fetchDayFolders({ limit: 30 }).then(setDayFolders),
    ]);
  }, [loadTasks]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      loadTasks(),
      fetchDayFolders({ limit: 30 }).then(setDayFolders),
    ]);
  }, [loadTasks]);

  const handlePause = useCallback(async (taskId: string) => {
    try {
      await pauseTask(taskId);
      showToast("任务已暂停", "success");
    } catch (err) {
      showToast(`暂停失败: ${err}`, "error");
    }
  }, []);

  const handleResume = useCallback(async (taskId: string) => {
    try {
      await resumeTask(taskId);
      showToast("任务已恢复", "success");
    } catch (err) {
      showToast(`恢复失败: ${err}`, "error");
    }
  }, []);

  const handleCancel = useCallback(async (taskId: string) => {
    try {
      await cancelTask(taskId);
      showToast("任务已取消", "warning");
    } catch (err) {
      showToast(`取消失败: ${err}`, "error");
    }
  }, []);

  const handleRetry = useCallback(async (
    taskId: string,
    retryProvider: CloudProvider
  ) => {
    try {
      await retryTask(taskId, retryProvider);
      showToast("任务已重新排队", "success");
    } catch (err) {
      showToast(`重试失败: ${err}`, "error");
    }
  }, []);

  const providerTasks = tasks.filter((task) =>
    task.destinations.some((destination) => destination.provider === provider)
  );
  const destinationStatus = (task: (typeof tasks)[number]) =>
    task.destinations.find((destination) => destination.provider === provider)
      ?.status;
  const activeTasks = providerTasks.filter(
    (task) => !["completed", "failed"].includes(destinationStatus(task) || "")
  );
  const doneTasks = tasks
    .filter((task) =>
      task.destinations.some(
        (destination) =>
          destination.provider === provider &&
          ["completed", "failed"].includes(destination.status)
      )
    )
    .slice(0, 10);

  return (
    <div className="p-6 space-y-6">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">任务面板</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openAnnotationWindow()}
          >
            <PenTool className="h-4 w-4 mr-1" />
            标注
          </Button>
          <Button variant="outline" size="sm" onClick={handleScan}>
            <PlayCircle className="h-4 w-4 mr-1" />
            触发扫描
          </Button>
          <Button size="sm" onClick={handleAddFolder}>
            <FolderPlus className="h-4 w-4 mr-1" />
            添加文件夹
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={handleRefresh}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="inline-flex rounded-md border p-1 bg-muted/30">
        {(["aliyun", "tencent"] as CloudProvider[]).map((item) => (
          <Button
            key={item}
            variant={provider === item ? "default" : "ghost"}
            size="sm"
            onClick={() => setProvider(item)}
          >
            {item === "aliyun" ? "阿里云" : "腾讯云"}
          </Button>
        ))}
      </div>

      {/* 扫描计划面板 */}
      <ScanSchedulePanel />

      {/* 磁盘用量 */}
      <DiskUsagePanel />

      {dayFolders.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            日期目录汇总 ({dayFolders.length})
          </h2>
          {dayFolders.map((dayFolder) => (
            <DayFolderCard key={dayFolder.id} dayFolder={dayFolder} />
          ))}
        </section>
      )}

      {/* 数据采集结果 */}
      {dataCollects.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            数据采集 ({dataCollects.length})
          </h2>
          {dataCollects.slice(0, 20).map((info) => (
            <DataCollectCard key={info.folderPath} info={info} />
          ))}
          {dataCollects.length > 20 && (
            <div className="text-xs text-muted-foreground text-center py-2">
              还有 {dataCollects.length - 20} 条记录...
            </div>
          )}
        </section>
      )}

      {/* 活跃任务 */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">
          活跃任务 ({activeTasks.length})
        </h2>
        {activeTasks.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12 border rounded-lg border-dashed">
            暂无活跃任务，点击"添加文件夹"或启动扫描开始上传
          </div>
        ) : (
          activeTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              provider={provider}
              progress={progress[progressKey(task.id, provider)]}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={handleCancel}
              onRetry={handleRetry}
            />
          ))
        )}
      </section>

      {/* 近期完成 */}
      {doneTasks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            近期完成
          </h2>
          {doneTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              provider={provider}
              progress={progress[progressKey(task.id, provider)]}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={handleCancel}
              onRetry={handleRetry}
            />
          ))}
        </section>
      )}
    </div>
  );
}
