export interface PathTreeEntry<T> {
  id: string;
  path: string;
  value: T;
}

export interface PathTreeNodeItem<T> {
  id: string;
  originalPath: string;
  value: T;
}

export interface PathTreeNode<T> {
  id: string;
  label: string;
  displayPath: string;
  depth: number;
  items: PathTreeNodeItem<T>[];
  children: PathTreeNode<T>[];
}

interface PathSegment {
  key: string;
  label: string;
  displayPath: string;
}

interface MutablePathTreeNode<T> extends PathTreeNode<T> {
  children: MutablePathTreeNode<T>[];
}

const KEY_SEPARATOR = "\u001f";

export function buildPathTree<T>(
  entries: Array<PathTreeEntry<T>>,
): Array<PathTreeNode<T>> {
  const roots: Array<MutablePathTreeNode<T>> = [];

  entries.forEach((entry) => {
    const segments = splitPathSegments(entry.path);
    if (segments.length === 0) return;

    let siblings = roots;
    let current: MutablePathTreeNode<T> | null = null;
    let nodeId = "";

    for (let depth = 0; depth < segments.length; depth += 1) {
      const segment = segments[depth];
      nodeId = nodeId
        ? `${nodeId}${KEY_SEPARATOR}${segment.key}`
        : segment.key;
      let node = siblings.find((item) => item.id === nodeId);

      if (!node) {
        node = {
          id: nodeId,
          label: segment.label,
          displayPath: segment.displayPath,
          depth,
          items: [],
          children: [],
        };
        siblings.push(node);
      }

      current = node;
      siblings = node.children;
    }

    current?.items.push({
      id: entry.id,
      originalPath: entry.path,
      value: entry.value,
    });
  });

  return roots;
}

export function buildPathTreeFromPaths(
  paths: Array<string>,
): Array<PathTreeNode<string>> {
  return buildPathTree(paths.map((path) => ({ id: path, path, value: path })));
}

export function splitPathSegments(rawPath: string): Array<PathSegment> {
  const normalized = stripTrailingSeparators(rawPath.replace(/\\/g, "/"));
  if (!normalized) return [];

  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\/(.*)|$)/);
  if (driveMatch) {
    return buildSegments({
      rootKey: `win:${driveMatch[1].toLowerCase()}`,
      rootLabel: driveMatch[1],
      rootDisplayPath: driveMatch[1],
      rest: driveMatch[2] ?? "",
      separator: "\\",
      childKeyPrefix: "win",
    });
  }

  if (normalized.startsWith("//")) {
    const parts = normalized.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length >= 2) {
      const [server, share, ...rest] = parts;
      return buildSegments({
        rootKey: `unc:${server.toLowerCase()}/${share.toLowerCase()}`,
        rootLabel: `\\\\${server}\\${share}`,
        rootDisplayPath: `\\\\${server}\\${share}`,
        rest: rest.join("/"),
        separator: "\\",
        childKeyPrefix: "unc",
      });
    }
  }

  if (normalized.startsWith("/")) {
    const parts = normalized.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length === 0) {
      return [{ key: "posix:/", label: "/", displayPath: "/" }];
    }

    const [root, ...rest] = parts;
    return buildSegments({
      rootKey: `posix:/${root}`,
      rootLabel: `/${root}`,
      rootDisplayPath: `/${root}`,
      rest: rest.join("/"),
      separator: "/",
      childKeyPrefix: "posix",
    });
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return [];

  const [root, ...rest] = parts;
  return buildSegments({
    rootKey: `relative:${root}`,
    rootLabel: root,
    rootDisplayPath: root,
    rest: rest.join("/"),
    separator: "/",
    childKeyPrefix: "relative",
  });
}

function buildSegments({
  rootKey,
  rootLabel,
  rootDisplayPath,
  rest,
  separator,
  childKeyPrefix,
}: {
  rootKey: string;
  rootLabel: string;
  rootDisplayPath: string;
  rest: string;
  separator: string;
  childKeyPrefix: string;
}): Array<PathSegment> {
  const segments: Array<PathSegment> = [
    {
      key: rootKey,
      label: rootLabel,
      displayPath: rootDisplayPath,
    },
  ];

  let displayPath = rootDisplayPath;
  for (const part of rest.split("/").filter(Boolean)) {
    displayPath = `${displayPath}${separator}${part}`;
    segments.push({
      key: `${childKeyPrefix}:${part}`,
      label: part,
      displayPath,
    });
  }

  return segments;
}

function stripTrailingSeparators(path: string): string {
  if (path === "/") return path;

  let end = path.length;
  while (end > 0 && path[end - 1] === "/") {
    const candidate = path.slice(0, end);
    if (candidate === "/" || /^[A-Za-z]:\/$/.test(candidate)) break;
    end -= 1;
  }

  return path.slice(0, end);
}
