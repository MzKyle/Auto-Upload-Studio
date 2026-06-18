import { CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils";
import type { DayFolderSummary } from "@shared/types";
import { DAY_FOLDER_STATUS_LABELS } from "@shared/constants";

const STATUS_VARIANT: Record<
  DayFolderSummary["status"],
  "default" | "secondary" | "destructive" | "success" | "warning" | "outline"
> = {
  collecting: "secondary",
  processing: "default",
  blocked: "destructive",
  completed: "success",
};

export function DayFolderCard({ dayFolder }: { dayFolder: DayFolderSummary }) {
  const percent =
    dayFolder.totalChildren > 0
      ? (dayFolder.completedChildren / dayFolder.totalChildren) * 100
      : 0;

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
          {dayFolder.completedAt && (
            <span className="text-xs text-muted-foreground">
              {new Date(dayFolder.completedAt).toLocaleString("zh-CN")}
            </span>
          )}
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
        </div>
        <div className="text-xs text-muted-foreground mt-1 truncate">
          {dayFolder.folderPath}
        </div>
      </CardContent>
    </Card>
  );
}
