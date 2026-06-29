import { Database } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import type { DataCollectInfo } from "@shared/types";

interface DataCollectCardProps {
  info: DataCollectInfo;
}

export function DataCollectCard({ info }: DataCollectCardProps) {
  const ws = info.weldSignal;
  const camSummary = info.cameras
    .map((c) => `${c.name}(${c.imageCount})`)
    .join(", ");

  return (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Database className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <span className="font-medium text-sm truncate">
              {info.folderName}
            </span>
            {info.date && <Badge variant="secondary">{info.date}</Badge>}
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {info.totalFileCount} 文件 | {formatBytes(info.totalSizeBytes)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {/* 焊接信号 */}
          <div>
            <span className="font-medium text-foreground">焊接: </span>
            {ws.durationSeconds !== null ? `${ws.durationSeconds}s` : "N/A"}
            {ws.arcStartTime && (
              <span className="ml-1">
                ({ws.arcStartTime?.split(" ")[1]?.slice(0, 8)} ~{" "}
                {ws.arcEndTime?.split(" ")[1]?.slice(0, 8)})
              </span>
            )}
          </div>

          {/* 相机 */}
          <div className="truncate">
            <span className="font-medium text-foreground">相机: </span>
            {camSummary || "无"}
          </div>

          {/* 机器人状态 */}
          <div>
            <span className="font-medium text-foreground">机器人: </span>
            关节{info.robotState.jointStateRows}行, 末端
            {info.robotState.toolPoseRows}行
            {info.robotState.hasCalibration && " [已标定]"}
          </div>

          {/* 控制指令 */}
          <div>
            <span className="font-medium text-foreground">控制: </span>
            速度{info.controlCmd.speedRows}行, 频率
            {info.controlCmd.freqRows}行
          </div>

          {/* 点云 & 深度 */}
          {(info.pointCloudCount > 0 || info.depthImageCount > 0) && (
            <div>
              <span className="font-medium text-foreground">3D: </span>
              {info.pointCloudCount > 0 && `点云${info.pointCloudCount}`}
              {info.pointCloudCount > 0 && info.depthImageCount > 0 && ", "}
              {info.depthImageCount > 0 && `深度图${info.depthImageCount}`}
            </div>
          )}

        </div>

        <div className="text-xs text-muted-foreground mt-1 truncate">
          {info.folderPath}
        </div>
      </CardContent>
    </Card>
  );
}
