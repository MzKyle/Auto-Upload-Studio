import { useEffect, useCallback } from 'react'
import { IPC } from '@shared/ipc-channels'
import type {
  TaskDestinationStatusEvent,
  TaskProgress,
  TaskStatusEvent
} from '@shared/types'
import { useTaskStore } from '@/stores/task.store'

export function useTaskProgress(): void {
  const setProgress = useTaskStore((s) => s.setProgress)
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus)
  const loadTasks = useTaskStore((s) => s.loadTasks)
  const updateDestinationStatus = useTaskStore((s) => s.updateDestinationStatus)

  const handleProgress = useCallback(
    (_event: unknown, data: unknown) => {
      setProgress(data as TaskProgress)
    },
    [setProgress]
  )

  const handleStatusChange = useCallback(
    (_event: unknown, data: unknown) => {
      const ev = data as TaskStatusEvent
      updateTaskStatus(ev.taskId, ev.newStatus)
      // 状态变更时重新加载完整列表
      loadTasks()
    },
    [updateTaskStatus, loadTasks]
  )

  useEffect(() => {
    const offProgress = window.api.on(IPC.TASK_PROGRESS, handleProgress as never)
    const offStatus = window.api.on(IPC.TASK_STATUS_CHANGE, handleStatusChange as never)
    const offDestination = window.api.on(
      IPC.TASK_DESTINATION_CHANGE,
      (_event: unknown, data: unknown) => {
        updateDestinationStatus(data as TaskDestinationStatusEvent)
      }
    )
    return () => {
      offProgress()
      offStatus()
      offDestination()
    }
  }, [handleProgress, handleStatusChange, updateDestinationStatus])
}
