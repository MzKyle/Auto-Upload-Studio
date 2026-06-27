import { useEffect, useCallback, useMemo, useState } from "react";
import { FolderPlus, RefreshCw, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskCard } from "@/components/TaskCard";
import { DataCollectCard } from "@/components/DataCollectCard";
import { ScanSchedulePanel } from "@/components/ScanSchedulePanel";
import { DiskUsagePanel } from "@/components/DiskUsagePanel";
import { DayFolderCard } from "@/components/DayFolderCard";
import { PathTree } from "@/components/PathTree";
import { useTaskStore } from "@/stores/task.store";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { showToast } from "@/components/ui/toast";
import { buildPathTree } from "@/lib/path-tree";
import {
  selectFolder,
  addFolder as addFolderApi,
  pauseTask,
  resumeTask,
  skipTask,
  restoreTask,
  retryTask,
  triggerScan,
  fetchDataCollectList,
  fetchDayFolders,
  ignoreDayFolder,
  restoreDayFolder,
} from "@/lib/ipc-client";
import { IPC } from "@shared/ipc-channels";
import type {
  CloudProvider,
  DataCollectInfo,
  DayFolderSummary,
  Task,
} from "@shared/types";
import { progressKey } from "@shared/cloud-upload";

type DashboardTreeItem =
  | { kind: "dayFolder"; dayFolder: DayFolderSummary }
  | { kind: "task"; task: Task };

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
      await skipTask(taskId);
      showToast("工作次已跳过", "warning");
    } catch (err) {
      showToast(`跳过失败: ${err}`, "error");
    }
  }, []);

  const handleRestore = useCallback(async (taskId: string) => {
    try {
      await restoreTask(taskId);
      await loadTasks();
      showToast("已恢复监控", "success");
    } catch (err) {
      showToast(`恢复失败: ${err}`, "error");
    }
  }, [loadTasks]);

  const handleIgnoreDay = useCallback(async (id: string) => {
    if (!window.confirm("确认忽略该日期下所有未完成工作次吗？")) return;
    await ignoreDayFolder(id);
    await Promise.all([
      loadTasks(),
      fetchDayFolders({ limit: 30 }).then(setDayFolders),
    ]);
  }, [loadTasks]);

  const handleRestoreDay = useCallback(async (id: string) => {
    await restoreDayFolder(id);
    await Promise.all([
      loadTasks(),
      fetchDayFolders({ limit: 30 }).then(setDayFolders),
    ]);
  }, [loadTasks]);

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

  const providerTasks = useMemo(
    () =>
      tasks.filter((task) =>
        task.destinations.some((destination) => destination.provider === provider),
      ),
    [tasks, provider],
  );
  const independentTasks = useMemo(
    () => providerTasks.filter((task) => !task.dayFolderId),
    [providerTasks],
  );
  const tasksByDayFolderId = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of providerTasks) {
      if (!task.dayFolderId) continue;
      const current = grouped.get(task.dayFolderId) ?? [];
      current.push(task);
      grouped.set(task.dayFolderId, current);
    }
    return grouped;
  }, [providerTasks]);
  const speedByDayFolderId = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const task of providerTasks) {
      if (!task.dayFolderId) continue;
      const current = grouped.get(task.dayFolderId) ?? 0;
      grouped.set(
        task.dayFolderId,
        current + (progress[progressKey(task.id, provider)]?.speed || 0),
      );
    }
    return grouped;
  }, [providerTasks, progress, provider]);
  const taskDirectoryTree = useMemo(
    () =>
      buildPathTree<DashboardTreeItem>([
        ...dayFolders.map((dayFolder) => ({
          id: `day:${dayFolder.id}`,
          path: dayFolder.folderPath,
          value: { kind: "dayFolder" as const, dayFolder },
        })),
        ...providerTasks.map((task) => ({
          id: `task:${task.id}`,
          path: task.folderPath,
          value: { kind: "task" as const, task },
        })),
      ]),
    [dayFolders, providerTasks],
  );
  const hasTaskDirectories = taskDirectoryTree.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">任务面板</h1>
        <div className="flex items-center gap-2">
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

      {hasTaskDirectories && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            任务目录 ({dayFolders.length} 日期 / {providerTasks.length} 任务)
          </h2>
          <PathTree
            nodes={taskDirectoryTree}
            className="rounded-md border bg-muted/10 p-2"
            renderNodeBody={({ node }) => {
              const dayItems = node.items.filter(
                (item) => item.value.kind === "dayFolder",
              );
              const taskItems = node.items.filter(
                (item) => item.value.kind === "task",
              );

              if (dayItems.length === 0 && taskItems.length === 0) {
                return null;
              }

              return (
                <div className="space-y-3">
                  {dayItems.map((item) => {
                    if (item.value.kind !== "dayFolder") return null;
                    const dayFolder = item.value.dayFolder;
                    const childTasks = tasksByDayFolderId.get(dayFolder.id) ?? [];

                    return (
                      <div key={dayFolder.id}>
                        <DayFolderCard
                          dayFolder={dayFolder}
                          tasks={childTasks}
                          speed={speedByDayFolderId.get(dayFolder.id) ?? 0}
                          onIgnore={handleIgnoreDay}
                          onRestore={handleRestoreDay}
                        />
                        {childTasks.length === 0 && (
                          <div className="ml-5 border-l pl-4 text-xs text-muted-foreground py-2">
                            尚未发现工作次
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {taskItems.map((item) => {
                    if (item.value.kind !== "task") return null;
                    const task = item.value.task;

                    return (
                      <TaskCard
                        key={task.id}
                        task={task}
                        provider={provider}
                        progress={progress[progressKey(task.id, provider)]}
                        onPause={handlePause}
                        onResume={handleResume}
                        onCancel={handleCancel}
                        onRetry={handleRetry}
                        onRestore={handleRestore}
                      />
                    );
                  })}
                </div>
              );
            }}
          />
          {independentTasks.length > 0 && (
            <div className="text-xs text-muted-foreground mt-2">
              独立任务 {independentTasks.length} 个
            </div>
          )}
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

    </div>
  );
}
