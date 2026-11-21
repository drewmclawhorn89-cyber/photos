import React from 'react';
import { AlertCircle, CheckCircle2, Film, Image as ImageIcon, Loader2, X } from 'lucide-react';
import type { UploadTask } from '../types/photo';
import { formatBytes } from '../lib/mediaCompression';

interface UploadQueueDrawerProps {
  tasks: UploadTask[];
  onDismissCompleted: () => void;
}

export const UploadQueueDrawer: React.FC<UploadQueueDrawerProps> = ({
  tasks,
  onDismissCompleted,
}) => {
  if (tasks.length === 0) return null;

  const activeCount = tasks.filter(
    (t) => t.stage === 'queued' || t.stage === 'compressing' || t.stage === 'uploading' || t.stage === 'saving'
  ).length;

  const stageLabel = (task: UploadTask): string => {
    switch (task.stage) {
      case 'queued':
        return 'Waiting';
      case 'compressing':
        return `Compressing video · ${task.progress}%`;
      case 'uploading':
        return `Uploading to R2 · ${task.progress}%`;
      case 'saving':
        return 'Saving metadata';
      case 'done': {
        const saved =
          task.originalSize > task.finalSize
            ? ` · Saved ${formatBytes(task.originalSize - task.finalSize)}`
            : '';
        return `Uploaded${saved}`;
      }
      case 'error':
        return task.errorMessage || 'Upload failed';
    }
  };

  return (
    <div className="fixed bottom-16 md:bottom-4 right-3 left-3 md:left-auto md:w-96 z-40 rounded-2xl bg-zinc-950/95 border border-white/15 backdrop-blur-md shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white tabular-nums">
          {activeCount > 0 ? `Uploading ${activeCount} ${activeCount === 1 ? 'file' : 'files'}` : 'Uploads finished'}
        </span>
        {activeCount === 0 && (
          <button
            type="button"
            onClick={onDismissCompleted}
            aria-label="Clear upload list"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="max-h-60 overflow-y-auto divide-y divide-white/5">
        {tasks.map((task) => {
          const isVideo = task.fileType.startsWith('video/');
          return (
            <div key={task.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isVideo ? (
                    <Film className="w-4 h-4 text-zinc-400 shrink-0" />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                  )}
                  <span className="text-xs font-medium text-white truncate">{task.fileName}</span>
                </div>

                {task.stage === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : task.stage === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-[#FE2C55] shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 text-white animate-spin shrink-0" />
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 tabular-nums">
                <span className={task.stage === 'error' ? 'text-[#FF6B86]' : ''}>
                  {stageLabel(task)}
                </span>
                <span>{formatBytes(task.finalSize || task.originalSize)}</span>
              </div>

              {task.stage !== 'done' && task.stage !== 'error' && (
                <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      task.stage === 'compressing' ? 'bg-amber-400' : 'bg-[#FE2C55]'
                    }`}
                    style={{ width: `${Math.max(4, task.progress)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
