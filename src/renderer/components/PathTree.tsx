import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PathTreeNode } from "@/lib/path-tree";

export interface PathTreeRenderContext<T> {
  node: PathTreeNode<T>;
  expanded: boolean;
  hasChildren: boolean;
  toggle: () => void;
}

interface PathTreeProps<T> {
  nodes: Array<PathTreeNode<T>>;
  className?: string;
  rowClassName?: string;
  defaultExpandedIds?: Array<string>;
  emptyText?: string;
  renderLabel?: (node: PathTreeNode<T>) => ReactNode;
  renderMeta?: (context: PathTreeRenderContext<T>) => ReactNode;
  renderActions?: (context: PathTreeRenderContext<T>) => ReactNode;
  renderNodeBody?: (context: PathTreeRenderContext<T>) => ReactNode;
}

export function PathTree<T>({
  nodes,
  className,
  rowClassName,
  defaultExpandedIds = [],
  emptyText = "暂无目录",
  renderLabel,
  renderMeta,
  renderActions,
  renderNodeBody,
}: PathTreeProps<T>) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpandedIds),
  );

  const toggleNode = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  if (nodes.length === 0) {
    return <div className="text-xs text-muted-foreground">{emptyText}</div>;
  }

  return (
    <div className={cn("space-y-1", className)}>
      {nodes.map((node) => (
        <PathTreeNodeView
          key={node.id}
          node={node}
          expandedIds={expandedIds}
          onToggle={toggleNode}
          rowClassName={rowClassName}
          renderLabel={renderLabel}
          renderMeta={renderMeta}
          renderActions={renderActions}
          renderNodeBody={renderNodeBody}
        />
      ))}
    </div>
  );
}

function PathTreeNodeView<T>({
  node,
  expandedIds,
  onToggle,
  rowClassName,
  renderLabel,
  renderMeta,
  renderActions,
  renderNodeBody,
}: {
  node: PathTreeNode<T>;
  expandedIds: Set<string>;
  onToggle: (nodeId: string) => void;
  rowClassName?: string;
  renderLabel?: (node: PathTreeNode<T>) => ReactNode;
  renderMeta?: (context: PathTreeRenderContext<T>) => ReactNode;
  renderActions?: (context: PathTreeRenderContext<T>) => ReactNode;
  renderNodeBody?: (context: PathTreeRenderContext<T>) => ReactNode;
}) {
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const title = node.items[0]?.originalPath ?? node.displayPath;
  const toggle = () => {
    if (hasChildren) onToggle(node.id);
  };
  const context: PathTreeRenderContext<T> = {
    node,
    expanded,
    hasChildren,
    toggle,
  };
  const body = renderNodeBody?.(context);

  return (
    <div>
      <div
        className={cn(
          "flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-sm",
          hasChildren && "cursor-pointer hover:bg-muted/70",
          rowClassName,
        )}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
        onClick={hasChildren ? toggle : undefined}
      >
        <button
          type="button"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
            hasChildren && "hover:bg-background hover:text-foreground",
          )}
          disabled={!hasChildren}
          aria-expanded={hasChildren ? expanded : undefined}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="h-4 w-4" />
          )}
        </button>

        {hasChildren && expanded ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate" title={title}>
            {renderLabel ? renderLabel(node) : node.label}
          </span>
          {renderMeta?.(context)}
        </div>

        {renderActions?.(context)}
      </div>

      {body && (
        <div
          className="mt-1"
          style={{ marginLeft: `${node.depth * 16 + 32}px` }}
        >
          {body}
        </div>
      )}

      {expanded && node.children.length > 0 && (
        <div className="space-y-1">
          {node.children.map((child) => (
            <PathTreeNodeView
              key={child.id}
              node={child}
              expandedIds={expandedIds}
              onToggle={onToggle}
              rowClassName={rowClassName}
              renderLabel={renderLabel}
              renderMeta={renderMeta}
              renderActions={renderActions}
              renderNodeBody={renderNodeBody}
            />
          ))}
        </div>
      )}
    </div>
  );
}
