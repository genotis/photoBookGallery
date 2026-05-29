import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, TreeRoot } from '../api';

interface NodeProps {
  name: string;
  path: string;
  count: number;
  level: number;
  selectedPath?: string;
  onSelect: (path: string | undefined) => void;
  defaultOpen?: boolean;
}

function TreeNode({
  name,
  path,
  count,
  level,
  selectedPath,
  onSelect,
  defaultOpen,
}: NodeProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const children = useQuery({
    queryKey: ['tree', path],
    queryFn: () => api.tree(path),
    enabled: open,
  });
  const isSelected = selectedPath === path;
  const hasChildren = (children.data?.children.length ?? 1) > 0;

  return (
    <li>
      <div
        className={`tree-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 6 + level * 14 }}
      >
        <button
          className="tree-twisty"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? '접기' : '펼치기'}
        >
          {open ? '▾' : '▸'}
        </button>
        <button
          className="tree-name"
          onClick={() => onSelect(isSelected ? undefined : path)}
          title={path}
        >
          {name}
        </button>
        <span className="tree-count">{count}</span>
      </div>
      {open && hasChildren && (
        <ul>
          {children.data?.children.map((c) => (
            <TreeNode
              key={c.path}
              name={c.name}
              path={c.path}
              count={c.archiveCount}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
          {children.isLoading && (
            <li className="muted small tree-loading">불러오는 중…</li>
          )}
        </ul>
      )}
    </li>
  );
}

export function PathBrowser({
  selectedPath,
  onSelect,
}: {
  selectedPath?: string;
  onSelect: (path: string | undefined) => void;
}) {
  const roots = useQuery({ queryKey: ['tree-roots'], queryFn: () => api.tree() });

  return (
    <section className="facet-section">
      <h4>폴더</h4>
      {selectedPath && (
        <div className="path-active">
          <span title={selectedPath}>{shortPath(selectedPath)}</span>
          <button
            className="ghost"
            onClick={() => onSelect(undefined)}
            aria-label="경로 필터 해제"
          >
            ✕
          </button>
        </div>
      )}
      <ul className="tree">
        {roots.data?.roots.map((r: TreeRoot) => (
          <TreeNode
            key={r.id}
            name={r.label ?? r.path}
            path={r.path}
            count={r.archiveCount}
            level={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
            defaultOpen
          />
        ))}
        {roots.data?.roots.length === 0 && (
          <li className="muted small">등록된 루트가 없습니다.</li>
        )}
      </ul>
    </section>
  );
}

function shortPath(p: string): string {
  if (p.length <= 40) return p;
  const segs = p.split('/');
  if (segs.length <= 3) return p;
  return `…/${segs.slice(-2).join('/')}`;
}

