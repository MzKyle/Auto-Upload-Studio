import { useCallback, useState } from "react";
import {
  ImagePlus,
  MousePointer2,
  Minus,
  CircleDot,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize,
  Undo2,
  Redo2,
  Upload,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationStore } from "@/stores/annotation.store";
import {
  selectAnnotationImage,
  readAnnotationImage,
  saveAnnotationExport,
  uploadAnnotationToOSS,
} from "@/lib/ipc-client";
import { getPointT, segmentLabel } from "../helpers/geometry";
import type { AnnotationTool } from "@shared/annotation-types";
import type Konva from "konva";

interface AnnotationToolbarProps {
  stageRef: React.RefObject<Konva.Stage | null>;
}

const tools: {
  id: AnnotationTool;
  label: string;
  icon: typeof MousePointer2;
}[] = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "draw-line", label: "画线", icon: Minus },
  { id: "add-split-point", label: "分割点", icon: CircleDot },
];

export function AnnotationToolbar({ stageRef }: AnnotationToolbarProps) {
  const {
    activeTool,
    setTool,
    loadImage,
    stageScale,
    setStageScale,
    setStagePosition,
    imageSize,
    imagePath,
    lines,
    subSegmentTypes,
    getExportBaseName,
    buildExportJson,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useAnnotationStore();

  // Track last export paths for upload
  const [lastExport, setLastExport] = useState<{
    pngPath: string;
    jsonPath: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const handleOpenImage = useCallback(async () => {
    const filePath = await selectAnnotationImage();
    if (!filePath) return;
    const result = await readAnnotationImage(filePath);
    loadImage(filePath, result.dataUrl, {
      width: result.width,
      height: result.height,
    });
    setLastExport(null);
    setUploadStatus(null);
  }, [loadImage]);

  const handleExport = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || !imageSize) return;

    // 1. Export the annotated canvas at native image resolution
    const prevScale = { x: stage.scaleX(), y: stage.scaleY() };
    const prevPos = { x: stage.x(), y: stage.y() };

    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.batchDraw();

    const stageDataUrl = stage.toDataURL({
      x: 0,
      y: 0,
      width: imageSize.width,
      height: imageSize.height,
      pixelRatio: 2,
    });

    // Restore stage view
    stage.scale(prevScale);
    stage.position(prevPos);
    stage.batchDraw();

    // 2. Build the info panel using an off-screen canvas
    const state = useAnnotationStore.getState();
    const infoLines: string[] = [];
    const fileName =
      (imagePath || "").replace(/\\/g, "/").split("/").pop() || "image";
    infoLines.push(
      `File: ${fileName}  |  Size: ${imageSize.width}x${imageSize.height}  |  Lines: ${state.lines.length}`
    );
    infoLines.push("");

    for (let li = 0; li < state.lines.length; li++) {
      const line = state.lines[li];
      const metaStr = Object.entries(line.meta)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      infoLines.push(
        `Line ${li + 1}${metaStr ? "  [" + metaStr + "]" : ""}  SplitPoints: ${
          line.splitPoints.length
        }  Segments: ${line.subSegments.length}`
      );

      for (let si = 0; si < line.subSegments.length; si++) {
        const seg = line.subSegments[si];
        const startT = getPointT(seg.startPointId, line.splitPoints);
        const endT = getPointT(seg.endPointId, line.splitPoints);
        const segType = state.subSegmentTypes.find((t) => t.id === seg.typeId);
        const label = segmentLabel(si);
        infoLines.push(
          `    ${label}: ${(Math.min(startT, endT) * 100).toFixed(1)}% - ${(
            Math.max(startT, endT) * 100
          ).toFixed(1)}%  Type: ${segType?.name || "N/A"}`
        );
      }
    }

    // Type legend
    const usedTypeIds = new Set(
      state.lines.flatMap((l) => l.subSegments.map((s) => s.typeId))
    );
    if (usedTypeIds.size > 0) {
      infoLines.push("");
      infoLines.push("Legend:");
      for (const t of state.subSegmentTypes) {
        if (usedTypeIds.has(t.id)) {
          infoLines.push(`    [${t.color}] ${t.name}`);
        }
      }
    }

    const lineHeight = 18;
    const padding = 16;
    const panelHeight = infoLines.length * lineHeight + padding * 2;
    const panelWidth = imageSize.width * 2; // match pixelRatio=2

    // Create the info panel canvas
    const infoCanvas = document.createElement("canvas");
    infoCanvas.width = panelWidth;
    infoCanvas.height = panelHeight;
    const ctx = infoCanvas.getContext("2d")!;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, panelWidth, panelHeight);
    ctx.fillStyle = "#e0e0e0";
    ctx.font = "13px monospace";

    for (let i = 0; i < infoLines.length; i++) {
      const line = infoLines[i];
      // Render color swatches for legend lines
      if (line.startsWith("    [#")) {
        const colorMatch = line.match(/\[([^\]]+)\]/);
        if (colorMatch) {
          const color = colorMatch[1];
          const textAfter = line.replace(`[${color}] `, "");
          const x = padding;
          const y = padding + i * lineHeight;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 12, 12);
          ctx.fillStyle = "#e0e0e0";
          ctx.fillText(textAfter, x + 18, y + 11);
          continue;
        }
      }
      ctx.fillStyle = i === 0 ? "#ffffff" : "#c0c0c0";
      ctx.fillText(line, padding, padding + i * lineHeight + 11);
    }

    // 3. Build JSON data
    const jsonString = buildExportJson();
    const baseName = getExportBaseName();

    // 4. Composite: stage image + info panel, then save both PNG + JSON
    const stageImg = new window.Image();
    stageImg.onload = async () => {
      const compositeCanvas = document.createElement("canvas");
      compositeCanvas.width = stageImg.width;
      compositeCanvas.height = stageImg.height + panelHeight;
      const cctx = compositeCanvas.getContext("2d")!;
      cctx.drawImage(stageImg, 0, 0);
      cctx.drawImage(infoCanvas, 0, stageImg.height);

      const finalDataUrl = compositeCanvas.toDataURL("image/png");
      const result = await saveAnnotationExport(
        finalDataUrl,
        jsonString,
        baseName
      );
      if (result) {
        setLastExport(result);
        setUploadStatus(null);
      }
    };
    stageImg.src = stageDataUrl;
  }, [
    stageRef,
    imageSize,
    imagePath,
    lines,
    subSegmentTypes,
    getExportBaseName,
    buildExportJson,
  ]);

  const handleUploadOSS = useCallback(async () => {
    if (!lastExport || !imagePath) return;
    setUploading(true);
    setUploadStatus(null);
    try {
      const result = await uploadAnnotationToOSS(
        imagePath,
        lastExport.pngPath,
        lastExport.jsonPath
      );
      if (result.ok) {
        setUploadStatus("ok");
      } else {
        setUploadStatus(
          result.results
            .filter((item) => !item.ok)
            .map(
              (item) =>
                `${item.provider === "aliyun" ? "阿里云" : "腾讯云"}: ${
                  item.error || "上传失败"
                }`
            )
            .join("；") || "上传失败"
        );
      }
    } catch (err) {
      setUploadStatus(String(err));
    } finally {
      setUploading(false);
    }
  }, [lastExport, imagePath]);

  const handleFitView = useCallback(() => {
    if (!imageSize || !stageRef.current) return;
    const container = stageRef.current.container();
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const scaleX = containerWidth / imageSize.width;
    const scaleY = containerHeight / imageSize.height;
    const scale = Math.min(scaleX, scaleY, 1) * 0.95;
    const x = (containerWidth - imageSize.width * scale) / 2;
    const y = (containerHeight - imageSize.height * scale) / 2;
    setStageScale(scale);
    setStagePosition({ x, y });
  }, [imageSize, stageRef, setStageScale, setStagePosition]);

  return (
    <div className="h-12 border-b flex items-center px-3 gap-3 bg-muted/30 flex-shrink-0">
      <Button variant="outline" size="sm" onClick={handleOpenImage}>
        <ImagePlus className="h-4 w-4 mr-1" />
        打开图片
      </Button>

      <div className="w-px h-6 bg-border" />

      <div className="flex items-center gap-1">
        {tools.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={activeTool === id ? "default" : "ghost"}
            size="sm"
            onClick={() => setTool(id)}
            title={label}
          >
            <Icon className="h-4 w-4 mr-1" />
            {label}
          </Button>
        ))}
      </div>

      <div className="w-px h-6 bg-border" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={undo}
          disabled={!canUndo()}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={redo}
          disabled={!canRedo()}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="w-px h-6 bg-border" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setStageScale(stageScale / 1.2)}
          title="缩小"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center select-none">
          {Math.round(stageScale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setStageScale(stageScale * 1.2)}
          title="放大"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleFitView}
          title="适应窗口"
        >
          <Maximize className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-1" />
          导出
        </Button>

        {lastExport && (
          <Button
            variant={uploadStatus === "ok" ? "secondary" : "outline"}
            size="sm"
            onClick={handleUploadOSS}
            disabled={uploading || uploadStatus === "ok"}
            title={
              uploadStatus === "ok"
                ? "已上传"
                : uploadStatus || "上传标注到云端"
            }
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            {uploadStatus === "ok" ? "已上传" : "上传云端"}
          </Button>
        )}

        {uploadStatus && uploadStatus !== "ok" && (
          <span
            className="text-xs text-destructive max-w-32 truncate"
            title={uploadStatus}
          >
            {uploadStatus}
          </span>
        )}
      </div>
    </div>
  );
}
