import { useEffect, useState, useCallback } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDuration } from "@/lib/utils";
import {
  fetchHistory,
  clearHistory,
  deleteHistoryItem,
  fetchDayFolders,
  deleteDayFolderHistory,
  retryTask,
  fetchSettings,
} from "@/lib/ipc-client";
import type {
  CloudProvider,
  DayFolderSummary,
  HistoryItem,
} from "@shared/types";
import { DayFolderCard } from "@/components/DayFolderCard";

export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dayFolders, setDayFolders] = useState<DayFolderSummary[]>([]);
  const [provider, setProvider] = useState<CloudProvider>("aliyun");
  const [providerReady, setProviderReady] = useState(false);
  const pageSize = 20;

  const load = useCallback(async () => {
    if (!providerReady) return;
    const result = await fetchHistory({ page, pageSize, provider });
    setItems(result.items);
    setTotal(result.total);
    const folders = await fetchDayFolders({
      includeCompleted: true,
      limit: 100,
      provider,
    });
    setDayFolders(
      folders.filter(
        (folder) =>
          folder.status === "completed" ||
          folder.status === "completed_with_skips",
      ),
    );
  }, [page, provider, providerReady]);

  useEffect(() => {
    fetchSettings()
      .then((settings) => {
        setProvider(settings.cloud.targetMode === "tencent" ? "tencent" : "aliyun");
      })
      .catch(() => {})
      .finally(() => setProviderReady(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClear = useCallback(async () => {
    await clearHistory(undefined, provider);
    load();
  }, [load, provider]);

  const handleDeleteDayFolder = useCallback(
    async (item: DayFolderSummary) => {
      const ok = window.confirm(`确认删除日期目录汇总「${item.date}」吗？`);
      if (!ok) return;
      setDeletingId(item.id);
      try {
        await deleteDayFolderHistory(item.id, provider);
        await load();
      } finally {
        setDeletingId(null);
      }
    },
    [load, provider]
  );

  const handleDeleteItem = useCallback(
    async (item: HistoryItem) => {
      const ok = window.confirm(`确认删除历史记录「${item.folderName}」吗？`);
      if (!ok) return;

      setDeletingId(item.id);
      try {
        await deleteHistoryItem(item.id, item.provider);
        if (items.length === 1 && page > 1) {
          setPage((p) => p - 1);
          return;
        }
        await load();
      } finally {
        setDeletingId(null);
      }
    },
    [items.length, load, page]
  );

  const handleRetry = useCallback(
    async (item: HistoryItem) => {
      await retryTask(item.id, item.provider);
      await load();
    },
    [load]
  );

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">历史记录</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={items.length === 0 && dayFolders.length === 0}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          清空历史
        </Button>
      </div>

      <div className="inline-flex rounded-md border p-1 bg-muted/30">
        {(["aliyun", "tencent"] as CloudProvider[]).map((item) => (
          <Button
            key={item}
            variant={provider === item ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setProvider(item);
              setPage(1);
            }}
          >
            {item === "aliyun" ? "阿里云" : "腾讯云"}
          </Button>
        ))}
      </div>

      {dayFolders.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            已完成日期目录
          </h2>
          {dayFolders.map((item) => (
            <div key={item.id} className="relative">
              <DayFolderCard dayFolder={item} />
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-3 bottom-3 text-destructive hover:text-destructive"
                onClick={() => handleDeleteDayFolder(item)}
                disabled={deletingId === item.id}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                删除汇总
              </Button>
            </div>
          ))}
        </section>
      )}

      <h2 className="text-sm font-semibold text-muted-foreground">
        工作次任务
      </h2>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-12 border rounded-lg border-dashed">
          暂无历史记录
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">文件夹</th>
                <th className="text-left p-3 font-medium">文件数</th>
                <th className="text-left p-3 font-medium">大小</th>
                <th className="text-left p-3 font-medium">耗时</th>
                <th className="text-left p-3 font-medium">状态</th>
                <th className="text-left p-3 font-medium">完成时间</th>
                <th className="text-left p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="p-3">{item.folderName}</td>
                  <td className="p-3">{item.fileCount}</td>
                  <td className="p-3">{formatBytes(item.totalBytes)}</td>
                  <td className="p-3">
                    {formatDuration(item.durationSeconds)}
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={
                        item.status === "completed" ? "success" : "destructive"
                      }
                    >
                      {item.status === "completed" ? "成功" : "失败"}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(item.completedAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="p-3">
                    {item.status === "failed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetry(item)}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        重试此云端
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteItem(item)}
                      disabled={deletingId === item.id}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {deletingId === item.id ? "删除中..." : "删除"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
