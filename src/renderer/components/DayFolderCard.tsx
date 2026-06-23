import { Ban, CalendarDays, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { formatBytes, formatSpeed } from "@/lib/utils";
import type { DayFolderSummary, Task } from "@shared/types";
import { DAY_FOLDER_STATUS_LABELS } from "@shared/constants";

const STATUS_VARIANT: Record<
  DayFolderSummary["status"],
  "default" | "secondary" | "destructive" | "success" | "warning" | "outline"
> = {
  collecting: "secondary",
  processing: "default",
  blocked: "destructive",
  completed: "success",
  completed_with_skips: "warning",
};

export function DayFolderCard({
  dayFolder,
  tasks = [],
  speed = 0,
  onIgnore,
  onRestore,
}: {
  dayFolder: DayFolderSummary;
  tasks?: Task[];
  speed?: number;
  onIgnore?: (id: string) => void;
  onRestore?: (id: string) => void;
}) {
  const percent =
    dayFolder.totalChildren > 0
      ? (dayFolder.completedChildren / dayFolder.totalChildren) * 100
      : 0;
  const count = (statuses: Task["status"][]) =>
    tasks.filter((task) => statuses.includes(task.status)).length;

  return (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{dayFolder.date}</span>
            <Badge variant={STATUS_VARIANT[dayFolder.status]}>
              {DAY_FOLDER_STATUS_LABELS[dayFolder.status]}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {dayFolder.completedAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(dayFolder.completedAt).toLocaleString("zh-CN")}
              </span>
            )}
            {dayFolder.ignored ? (
              onRestore && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRestore(dayFolder.id)}
                >
                  <Undo2 className="h-3.5 w-3.5 mr-1" />
                  恢复日期
                </Button>
              )
            ) : (
              onIgnore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onIgnore(dayFolder.id)}
                >
                  <Ban className="h-3.5 w-3.5 mr-1" />
                  忽略日期
                </Button>
              )
            )}
          </div>
        </div>

        <Progress value={percent} className="mb-2" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            焊接目录 {dayFolder.completedChildren} / {dayFolder.totalChildren}
          </span>
          <span>
            文件 {dayFolder.uploadedFiles} / {dayFolder.totalFiles}
          </span>
          <span>
            {formatBytes(dayFolder.uploadedBytes)} / {formatBytes(dayFolder.totalBytes)}
          </span>
          {tasks.length > 0 && (
            <>
              <span>已同步 {count(["synced", "completed"])}</span>
              <span>上传中 {count(["uploading", "scanning", "pending"])}</span>
              <span>重试 {count(["retrying"])}</span>
              <span>需处理 {count(["failed", "paused"])}</span>
              <span>跳过 {count(["skipped"])}</span>
            </>
          )}
          {speed > 0 && <span>总速度 {formatSpeed(speed)}</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-1 truncate">
          {dayFolder.folderPath}
        </div>
      </CardContent>
    </Card>
  );
}
