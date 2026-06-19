import {
  Folder,
  Pause,
  Play,
  RotateCcw,
  X,
  ArrowUpFromLine,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatSpeed } from "@/lib/utils";
import type { CloudProvider, Task, TaskProgress } from "@shared/types";
import { CLOUD_PROVIDER_LABELS, TASK_STATUS_LABELS } from "@shared/constants";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning" | "outline"
> = {
  pending: "secondary",
  scanning: "warning",
  uploading: "default",
  completed: "success",
  failed: "destructive",
  paused: "outline",
};

interface TaskCardProps {
  task: Task;
  provider: CloudProvider;
  progress?: TaskProgress;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string, provider: CloudProvider) => void;
}

export function TaskCard({
  task,
  provider,
  progress,
  onPause,
  onResume,
  onCancel,
  onRetry,
}: TaskCardProps) {
  const destination = task.destinations.find((item) => item.provider === provider);
  if (!destination) return null;
  const status = destination.status;
  const uploadedFiles = progress?.uploadedFiles ?? destination.uploadedFiles;
  const totalFiles = progress?.totalFiles ?? destination.totalFiles;
  const uploadedBytes = progress?.uploadedBytes ?? destination.uploadedBytes;
  const totalBytes = progress?.totalBytes ?? destination.totalBytes;
  const speed = progress?.speed ?? 0;
  const percent = totalFiles > 0 ? (uploadedFiles / totalFiles) * 100 : 0;

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
            {(task.status === "pending" ||
              task.status === "uploading" ||
              task.status === "paused") && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                onClick={() => onCancel(task.id)}
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

        {progress?.currentFile && status === "uploading" && (
          <div className="text-xs text-muted-foreground mt-1 truncate">
            正在上传: {progress.currentFile}
          </div>
        )}

        {destination.errorMessage && (
          <div className="text-xs text-destructive mt-1 truncate">
            错误: {destination.errorMessage}
          </div>
        )}

        <div className="text-xs text-muted-foreground mt-1">
          {task.folderPath}
        </div>
      </CardContent>
    </Card>
  );
}
