import {
  Folder,
  Pause,
  Play,
  RotateCcw,
  X,
  ArrowUpFromLine,
  ListTree,
} from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatSpeed } from "@/lib/utils";
import type {
  CloudProvider,
  Task,
  TaskDetail,
  TaskProgress,
} from "@shared/types";
import { CLOUD_PROVIDER_LABELS, TASK_STATUS_LABELS } from "@shared/constants";
import { fetchTaskDetail } from "@/lib/ipc-client";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning" | "outline"
> = {
  pending: "secondary",
  scanning: "warning",
  uploading: "default",
  synced: "success",
  retrying: "warning",
  completed: "success",
  failed: "destructive",
  paused: "outline",
  skipped: "outline",
};

interface TaskCardProps {
  task: Task;
  provider: CloudProvider;
  progress?: TaskProgress;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string, provider: CloudProvider) => void;
  onRestore: (id: string) => void;
}

export function TaskCard({
  task,
  provider,
  progress,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRestore,
}: TaskCardProps) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const destination = task.destinations.find((item) => item.provider === provider);
  if (!destination) return null;
  const status = destination.status;
  const uploadedFiles = progress?.uploadedFiles ?? destination.uploadedFiles;
  const totalFiles = progress?.totalFiles ?? destination.totalFiles;
  const uploadedBytes = progress?.uploadedBytes ?? destination.uploadedBytes;
  const totalBytes = progress?.totalBytes ?? destination.totalBytes;
  const speed = progress?.speed ?? 0;
  const percent = totalFiles > 0 ? (uploadedFiles / totalFiles) * 100 : 0;
  const loadDetail = async () => {
    if (!detailOpen && !detail) {
      setDetail(await fetchTaskDetail(task.id));
    }
    setDetailOpen((value) => !value);
  };

  return (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm truncate">
              {task.folderName}
            </span>
            <Badge variant={STATUS_VARIANT[status] || "secondary"}>
              {TASK_STATUS_LABELS[status] || status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {CLOUD_PROVIDER_LABELS[provider]}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {task.status === "uploading" && status === "uploading" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onPause(task.id)}
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            )}
            {task.status === "paused" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onResume(task.id)}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            {status === "failed" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onRetry(task.id, provider)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            {task.status === "skipped" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="恢复监控"
                onClick={() => onRestore(task.id)}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            {(task.status === "pending" ||
              task.status === "scanning" ||
              task.status === "uploading" ||
              task.status === "retrying" ||
              task.status === "paused" ||
              task.status === "failed") && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                onClick={() => onCancel(task.id)}
                title="跳过此工作次"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <Progress value={percent} className="mb-2" />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              {uploadedFiles} / {totalFiles} 文件
            </span>
            <span>
              {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
            </span>
          </div>
          {status === "uploading" && speed > 0 && (
            <div className="flex items-center gap-1">
              <ArrowUpFromLine className="h-3 w-3" />
              <span>{formatSpeed(speed)}</span>
            </div>
          )}
        </div>

        {progress && (
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
            <span>排队 {progress.queuedFiles}</span>
            <span>上传中 {progress.activeUploads}</span>
            <span>失败 {progress.failedFiles}</span>
            <span>跳过 {progress.skippedFiles}</span>
            <span>本轮传输 {formatBytes(progress.transferredBytes)}</span>
          </div>
        )}

        {progress?.currentFile && status === "uploading" && (
          <div className="text-xs text-muted-foreground mt-1 truncate">
            正在上传: {progress.currentFile}
          </div>
        )}

        {destination.errorMessage && (
          <div className="text-xs text-destructive mt-1 whitespace-pre-wrap break-all">
            错误: {destination.errorMessage}
          </div>
        )}

        <div className="flex items-center justify-between mt-1 gap-2">
          <div className="text-xs text-muted-foreground break-all">
            {task.folderPath}
          </div>
          <Button variant="ghost" size="sm" onClick={loadDetail}>
            <ListTree className="h-3.5 w-3.5 mr-1" />
            {detailOpen ? "收起" : "文件详情"}
          </Button>
        </div>

        {detailOpen && detail && (
          <div className="mt-2 max-h-56 overflow-auto rounded border text-xs">
            {detail.files.length === 0 ? (
              <div className="p-3 text-muted-foreground">尚未发现文件</div>
            ) : (
              detail.files.map((file) => {
                const fileDestination = file.destinations.find(
                  (item) => item.provider === provider,
                );
                return (
                  <div
                    key={`${file.id}:${provider}`}
                    className="p-2 border-b last:border-b-0"
                  >
                    <div className="flex justify-between gap-3">
                      <span className="break-all">{file.relativePath}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {TASK_STATUS_LABELS[fileDestination?.status || file.status] ||
                          fileDestination?.status ||
                          file.status}
                      </span>
                    </div>
                    {(fileDestination?.errorMessage || file.errorMessage) && (
                      <div className="text-destructive mt-1 break-all">
                        {fileDestination?.errorMessage || file.errorMessage}
                      </div>
                    )}
                    {file.nextRetryAt && (
                      <div className="text-muted-foreground mt-1">
                        下次重试：
                        {new Date(file.nextRetryAt).toLocaleString("zh-CN")}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
