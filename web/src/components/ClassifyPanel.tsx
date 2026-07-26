import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  AssignTarget,
  ClassifyPreview,
  ClassifyRule,
  ClassifyRuleInput,
  RuleAssignment,
  Root,
} from '../api';
import { PathBrowser } from './PathBrowser';
import { useJobStream } from './useJobStream';

const STATUS_LABEL: Record<string, string> = {
  move: '이동',
  conflict: '충돌',
  error: '오류',
  noop: '제자리',
  none: '태깅만',
};

const TARGET_LABEL: Record<AssignTarget, string> = {
  country: '국가',
  model: '모델',
  publisher: '출판사',
  series: '시리즈',
  title: '제목',
  tag: '태그',
};
const TARGETS = Object.keys(TARGET_LABEL) as AssignTarget[];

const EMPTY_FORM: ClassifyRuleInput = {
  name: '',
  matchType: 'regex',
  pattern: '',
  destTemplate: '',
  assignments: [],
  priority: 0,
  enabled: true,
  rootId: null,
  scanCron: null,
  scheduleOn: false,
  batchLimit: null,
};

function invalidateAfterMove(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['archives'] });
  qc.invalidateQueries({ queryKey: ['facets'] });
  qc.invalidateQueries({ queryKey: ['tree'] });
  qc.invalidateQueries({ queryKey: ['classifyRules'] });
  qc.invalidateQueries({ queryKey: ['classifyHistory'] });
}

/** 절대경로에서 표시용 짧은 경로(마지막 2조각)만 남긴다. */
function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

/** 라벨 없는 루트의 표시명 — 경로 마지막 조각. */
function rootName(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** 대상 폴더 표시용 — 마지막 2조각. */
function folderTail(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || p;
}

function HistorySection() {
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ['classifyHistory'],
    queryFn: () => api.classifyHistory(200),
  });
  const [jobId, setJobId] = useState<number | null>(null);

  const revert = useMutation({
    mutationFn: (payload: { moveIds?: number[]; jobId?: number }) =>
      api.classifyRevert(payload),
    onSuccess: ({ jobId }) => setJobId(jobId),
  });

  const job = useJobStream(jobId);
  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') {
      invalidateAfterMove(qc);
    }
  }, [job?.status, qc]);

  const moves = history.data ?? [];
  const revertable = moves.filter((m) => m.status === 'moved');
  const latestJobId = revertable[0]?.jobId ?? undefined;
  const busy = revert.isPending || jobActive(job?.status);

  if (moves.length === 0) {
    return (
      <details className="classify-history">
        <summary>이동 이력</summary>
        <p className="muted small">이동 이력이 없습니다.</p>
      </details>
    );
  }

  return (
    <details className="classify-history">
      <summary>
        이동 이력 <span className="left-nav-count">{revertable.length}</span>
      </summary>

      <div className="auto-tag-actions">
        <button
          type="button"
          className="ghost"
          disabled={busy || latestJobId === undefined}
          onClick={() => {
            if (
              latestJobId !== undefined &&
              window.confirm('가장 최근 분류 실행을 통째로 원복합니다.\n파일이 원위치로 되돌아갑니다.')
            ) {
              revert.mutate({ jobId: latestJobId });
            }
          }}
        >
          최근 실행 원복
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || revertable.length === 0}
          onClick={() => {
            if (window.confirm('되돌릴 수 있는 모든 이동을 원복합니다.')) {
              revert.mutate({ moveIds: revertable.map((m) => m.id) });
            }
          }}
        >
          전체 원복
        </button>
      </div>

      <ul className="classify-history-list">
        {moves.slice(0, 30).map((m) => (
          <li key={m.id} className={m.status}>
            <div className="auto-tag-name" title={`${m.fromPath} → ${m.toPath}`}>
              {m.fileName}
            </div>
            <div className="auto-tag-chips">
              <span className={`suggest-chip status-${m.status === 'reverted' ? 'error' : 'move'}`}>
                {m.status === 'reverted' ? '원복됨' : '이동'}
              </span>
              <span className="classify-destrel">
                {shortPath(m.fromPath)} → {shortPath(m.toPath)}
              </span>
              {m.ruleName && <span className="muted small">[{m.ruleName}]</span>}
              {m.status === 'moved' && (
                <button
                  type="button"
                  className="ghost classify-revert-btn"
                  disabled={busy}
                  onClick={() => revert.mutate({ moveIds: [m.id] })}
                >
                  원복
                </button>
              )}
            </div>
          </li>
        ))}
        {moves.length > 30 && (
          <li className="muted small">… 외 {moves.length - 30}건</li>
        )}
      </ul>

      {job && job.status !== 'done' && job.status !== 'failed' && (
        <div className="job">원복 중… {Math.round((job.progress ?? 0) * 100)}%</div>
      )}
      {job?.status === 'done' && <RevertStats payload={job.payload} />}
      {job?.status === 'failed' && (
        <p className="error small">원복 실패: {job.error}</p>
      )}
      {revert.isError && (
        <p className="error small">{(revert.error as Error).message}</p>
      )}
    </details>
  );
}

function RevertStats({ payload }: { payload: string | undefined | null }) {
  const s = parseRevertStats(payload);
  if (!s) return <div className="job done">원복 완료 ✓</div>;
  return (
    <div className="job done">
      원복 완료 — 원복 {s.reverted} · 충돌 {s.conflicts} · 오류 {s.errors} · 스킵{' '}
      {s.skipped}
    </div>
  );
}

function parseRevertStats(payload: string | undefined | null): {
  reverted: number;
  conflicts: number;
  errors: number;
  skipped: number;
} | null {
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload) as {
      stats?: {
        reverted?: number;
        conflicts?: number;
        errors?: number;
        skipped?: number;
      };
    };
    if (!obj.stats) return null;
    return {
      reverted: obj.stats.reverted ?? 0,
      conflicts: obj.stats.conflicts ?? 0,
      errors: obj.stats.errors ?? 0,
      skipped: obj.stats.skipped ?? 0,
    };
  } catch {
    return null;
  }
}

function RuleRow({
  rule,
  roots,
  dnd,
}: {
  rule: ClassifyRule;
  roots: Root[];
  dnd?: {
    onDragStart: () => void;
    onDragEnter: () => void;
    onDrop: () => void;
    onDragEnd: () => void;
    isTarget: boolean;
    isDragging: boolean;
  };
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClassifyRuleInput>(toForm(rule));
  const [jobId, setJobId] = useState<number | null>(null);

  useEffect(() => {
    if (!editing) setForm(toForm(rule));
  }, [editing, rule]);

  const patch = useMutation({
    mutationFn: (data: Partial<ClassifyRuleInput>) =>
      api.patchClassifyRule(rule.id, data),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['classifyRules'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removeClassifyRule(rule.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classifyRules'] }),
  });

  const run = useMutation({
    mutationFn: () =>
      api.classifyApply([rule.id], true, rule.batchLimit ?? undefined),
    onSuccess: ({ jobId }) => setJobId(jobId),
  });

  const job = useJobStream(jobId);
  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') {
      invalidateAfterMove(qc);
    }
  }, [job?.status, qc]);

  const rootLabel = rule.rootId
    ? roots.find((r) => r.id === rule.rootId)?.label ??
      roots.find((r) => r.id === rule.rootId)?.path ??
      `#${rule.rootId}`
    : '모든 루트';

  return (
    <li
      className={`classify-rule ${rule.enabled ? '' : 'disabled'} ${
        dnd?.isTarget ? 'drop-target' : ''
      } ${dnd?.isDragging ? 'dragging' : ''}`}
      onDragEnter={dnd ? () => dnd.onDragEnter() : undefined}
      onDragOver={dnd ? (e) => e.preventDefault() : undefined}
      onDrop={
        dnd
          ? (e) => {
              e.preventDefault();
              dnd.onDrop();
            }
          : undefined
      }
    >
      <div className="classify-rule-head">
        {dnd && (
          <span
            className="rule-drag-handle"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              dnd.onDragStart();
            }}
            onDragEnd={() => dnd.onDragEnd()}
            title="드래그해서 우선순위 변경"
            aria-label="드래그 핸들"
          >
            ⠿
          </span>
        )}
        <label className="check small" title="규칙 사용">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => patch.mutate({ enabled: e.target.checked })}
          />
          <strong>{rule.name}</strong>
        </label>
        <span className="muted small">우선순위 {rule.priority}</span>
      </div>

      {!editing ? (
        <>
          <div className="classify-rule-body small">
            <code className="classify-pat">
              {rule.matchType === 'glob' ? 'glob' : 're'}: {rule.pattern}
            </code>
            <span className="classify-arrow">→</span>
            {(rule.assignments ?? []).map((a, i) => (
              <span key={i} className="assign-chip">
                {TARGET_LABEL[a.target]}=
                {a.source === 'group' ? `{${a.key}}` : a.value}
              </span>
            ))}
            {rule.destTemplate ? (
              <code className="classify-dest" title="이동 목적지">
                📁 {rule.destTemplate}
              </code>
            ) : (
              (rule.assignments ?? []).length === 0 && (
                <span className="muted">액션 없음</span>
              )
            )}
          </div>
          <div className="classify-rule-meta muted small">
            <span>{rootLabel}</span>
            <label className="check small" title="스케줄 켜기/끄기">
              <input
                type="checkbox"
                checked={rule.scheduleOn}
                disabled={!rule.scanCron}
                onChange={(e) => patch.mutate({ scheduleOn: e.target.checked })}
              />
              스케줄 {rule.scanCron ? `(${rule.scanCron})` : '없음'}
            </label>
            <span title="한 실행당 최대 이동 건수">
              배치 {rule.batchLimit ? `${rule.batchLimit}건` : '무제한'}
            </span>
            {rule.lastRunAt && (
              <span>최근 {new Date(rule.lastRunAt).toLocaleString()}</span>
            )}
          </div>
        </>
      ) : (
        <RuleForm form={form} setForm={setForm} roots={roots} />
      )}

      <div className="root-actions">
        {editing ? (
          <>
            <button
              onClick={() => patch.mutate(form)}
              disabled={patch.isPending}
            >
              저장
            </button>
            <button className="ghost" onClick={() => setEditing(false)}>
              취소
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `규칙 "${rule.name}" 을 지금 실행해 매칭 파일을 이동합니다.\n실제 파일이 이동됩니다.`,
                  )
                ) {
                  run.mutate();
                }
              }}
              disabled={run.isPending || jobActive(job?.status)}
            >
              지금 실행
            </button>
            <button className="ghost" onClick={() => setEditing(true)}>
              편집
            </button>
            <button
              className="ghost danger-outline"
              onClick={() => {
                if (window.confirm(`규칙 "${rule.name}" 을 삭제합니다.`)) {
                  remove.mutate();
                }
              }}
            >
              삭제
            </button>
          </>
        )}
      </div>

      {patch.isError && (
        <p className="error small">{(patch.error as Error).message}</p>
      )}
      {run.isError && (
        <p className="error small">{(run.error as Error).message}</p>
      )}
      {job && job.status !== 'done' && job.status !== 'failed' && (
        <div className="job">이동 중… {Math.round((job.progress ?? 0) * 100)}%</div>
      )}
      {job?.status === 'done' && <MoveStats payload={job.payload} />}
      {job?.status === 'failed' && (
        <p className="error small">실패: {job.error}</p>
      )}
    </li>
  );
}

function AssignmentsEditor({
  assignments,
  onChange,
}: {
  assignments: RuleAssignment[];
  onChange: (a: RuleAssignment[]) => void;
}) {
  const update = (i: number, patch: Partial<RuleAssignment>) =>
    onChange(assignments.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const add = () =>
    onChange([
      ...assignments,
      { target: 'tag', source: 'group', key: '', value: '' },
    ]);
  const remove = (i: number) =>
    onChange(assignments.filter((_, j) => j !== i));

  return (
    <div className="assign-editor">
      <div className="assign-head">
        <span className="behavior-label">태깅 (메타 채우기)</span>
        <button type="button" className="ghost" onClick={add}>
          + 액션
        </button>
      </div>
      {assignments.length === 0 && (
        <p className="muted small">
          액션 없음 — 이동만 하려면 아래 목적지를 채우세요. 국가·모델·태그를 채우려면
          액션을 추가하세요.
        </p>
      )}
      {assignments.map((a, i) => (
        <div key={i} className="assign-row">
          <select
            value={a.target}
            onChange={(e) =>
              update(i, { target: e.target.value as AssignTarget })
            }
            title="채울 필드"
          >
            {TARGETS.map((t) => (
              <option key={t} value={t}>
                {TARGET_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            value={a.source}
            onChange={(e) =>
              update(i, { source: e.target.value as 'group' | 'literal' })
            }
            title="값의 출처"
          >
            <option value="group">그룹</option>
            <option value="literal">리터럴</option>
          </select>
          {a.source === 'group' ? (
            <input
              className="grow"
              value={a.key ?? ''}
              placeholder="정규식 named group 이름 (예: country)"
              onChange={(e) => update(i, { key: e.target.value })}
            />
          ) : (
            <input
              className="grow"
              value={a.value ?? ''}
              placeholder="고정 값 (예: AI)"
              onChange={(e) => update(i, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            className="ghost assign-del"
            onClick={() => remove(i)}
            title="삭제"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function RuleForm({
  form,
  setForm,
  roots,
}: {
  form: ClassifyRuleInput;
  setForm: (f: ClassifyRuleInput) => void;
  roots: Root[];
}) {
  const set = (patch: Partial<ClassifyRuleInput>) =>
    setForm({ ...form, ...patch });
  return (
    <div className="root-edit classify-form">
      <label>
        이름
        <input
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <div className="classify-form-row">
        <label>
          매칭
          <select
            value={form.matchType}
            onChange={(e) =>
              set({ matchType: e.target.value as 'regex' | 'glob' })
            }
          >
            <option value="regex">정규식</option>
            <option value="glob">글롭</option>
          </select>
        </label>
        <label className="grow">
          패턴
          <input
            value={form.pattern}
            placeholder={
              form.matchType === 'glob'
                ? '예: *[Weekly Post]*'
                : '예: ^\\[(?<country>[A-Z]{2,3})\\]'
            }
            onChange={(e) => set({ pattern: e.target.value })}
          />
        </label>
      </div>
      <AssignmentsEditor
        assignments={form.assignments ?? []}
        onChange={(a) => set({ assignments: a })}
      />
      <label>
        이동 목적지 템플릿 (선택 — 비우면 태깅만, 파일 이동 안 함)
        <input
          value={form.destTemplate ?? ''}
          placeholder="예: {country}/{name}  (비우면 이동 안 함)"
          onChange={(e) => set({ destTemplate: e.target.value })}
        />
      </label>
      <div className="classify-form-row">
        <label>
          우선순위
          <input
            type="number"
            value={form.priority ?? 0}
            onChange={(e) => set({ priority: Number(e.target.value) })}
          />
        </label>
        <label className="grow">
          대상 루트
          <select
            value={form.rootId ?? ''}
            onChange={(e) =>
              set({ rootId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">모든 루트</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label ?? r.path}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="classify-form-row">
        <label className="grow">
          스케줄 cron
          <input
            value={form.scanCron ?? ''}
            placeholder='예: "0 3 * * *" (매일 03:00)'
            onChange={(e) => set({ scanCron: e.target.value || null })}
          />
        </label>
        <label className="check small">
          <input
            type="checkbox"
            checked={form.scheduleOn ?? false}
            onChange={(e) => set({ scheduleOn: e.target.checked })}
          />
          스케줄 켜기
        </label>
      </div>
      <label>
        한 번에 최대 건수 (배치)
        <input
          type="number"
          min={1}
          value={form.batchLimit ?? ''}
          placeholder="비우면 무제한"
          onChange={(e) =>
            set({ batchLimit: e.target.value ? Number(e.target.value) : null })
          }
        />
      </label>
      <p className="muted small">
        스케줄·실행 시 한 번에 이 건수까지만 이동하고 나머지는 다음 실행에서
        처리합니다. 대량 이동으로 시스템에 부하가 가는 걸 막습니다.
      </p>
      <p className="muted small">
        경로 토큰: <code>{'{fileName}'}</code> <code>{'{stem}'}</code>{' '}
        <code>{'{ext}'}</code> · 메타 토큰 <code>{'{country}'}</code>(국가코드){' '}
        <code>{'{name}'}</code>(첫 모델) · 정규식 named group 은 그 이름으로.
      </p>
    </div>
  );
}

function AddRule({ roots }: { roots: Root[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ClassifyRuleInput>(EMPTY_FORM);
  const [open, setOpen] = useState(false);

  const add = useMutation({
    mutationFn: () => api.createClassifyRule(form),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['classifyRules'] });
    },
  });

  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        + 규칙 추가
      </button>
    );
  }
  return (
    <div className="classify-add">
      <RuleForm form={form} setForm={setForm} roots={roots} />
      {add.isError && (
        <p className="error small">{(add.error as Error).message}</p>
      )}
      <div className="root-actions">
        <button
          onClick={() => add.mutate()}
          disabled={
            add.isPending ||
            !form.name.trim() ||
            !form.pattern.trim() ||
            (!form.destTemplate?.trim() &&
              (form.assignments ?? []).length === 0)
          }
        >
          추가
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
    </div>
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function BackupSection() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const exportMut = useMutation({
    mutationFn: () => api.classifyExport(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      a.href = url;
      a.download = `classify-rules-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const rules = Array.isArray(parsed)
        ? parsed
        : ((parsed as { rules?: unknown[] })?.rules ?? null);
      if (!Array.isArray(rules)) {
        throw new Error('올바른 백업 파일이 아닙니다 (rules 배열 없음).');
      }
      return api.classifyImport({ mode, rules });
    },
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ['classifyRules'] });
    },
  });

  return (
    <div className="classify-backup">
      <div className="auto-tag-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => exportMut.mutate()}
          disabled={exportMut.isPending}
        >
          ⬇ 규칙 백업(JSON)
        </button>
        <label className="check small" title="가져오기 방식">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
          >
            <option value="merge">추가(merge)</option>
            <option value="replace">대체(replace)</option>
          </select>
        </label>
        <button
          type="button"
          className="ghost"
          onClick={() => fileRef.current?.click()}
          disabled={importMut.isPending}
        >
          ⬆ 복구(가져오기)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // 같은 파일 재선택 허용
            if (!file) return;
            if (
              mode === 'replace' &&
              !window.confirm(
                '기존 규칙을 모두 삭제하고 파일 내용으로 대체합니다. 계속할까요?',
              )
            ) {
              return;
            }
            setResult(null);
            importMut.mutate(file);
          }}
        />
      </div>
      {importMut.isError && (
        <p className="error small">{(importMut.error as Error).message}</p>
      )}
      {result && (
        <div className="job done">
          가져오기 완료 — 추가 {result.imported} · 건너뜀 {result.skipped}
          {result.warnings.map((w, i) => (
            <p key={`w${i}`} className="muted small">
              ⚠ {w}
            </p>
          ))}
          {result.errors.map((er, i) => (
            <p key={`e${i}`} className="error small">
              {er}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClassifyPanel() {
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: ['classifyRules'],
    queryFn: api.classifyRules,
  });
  const roots = useQuery({ queryKey: ['roots'], queryFn: api.roots });
  const [preview, setPreview] = useState<ClassifyPreview | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  // 대상 폴더 — 이 폴더 하위 아카이브에만 미리보기·적용. undefined = 전체.
  const [targetPath, setTargetPath] = useState<string | undefined>(undefined);

  const previewMut = useMutation({
    mutationFn: () => api.classifyPreview(undefined, 50, targetPath),
    onSuccess: (data) => setPreview(data),
  });
  const applyMut = useMutation({
    mutationFn: () => api.classifyApply(undefined, false, undefined, targetPath),
    onSuccess: ({ jobId }) => setJobId(jobId),
  });

  const job = useJobStream(jobId);
  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') {
      invalidateAfterMove(qc);
      setPreview(null);
    }
  }, [job?.status, qc]);

  const rootList = roots.data ?? [];

  // ---- 드래그 우선순위 재정렬 ----
  // 서버 순서(priority asc) 를 로컬 order 로 미러링. 드래그 중에는 로컬만 바꾸고
  // drop 시 서버에 새 순서를 보낸다.
  const [order, setOrder] = useState<number[]>([]);
  useEffect(() => {
    if (rules.data) setOrder(rules.data.map((r) => r.id));
  }, [rules.data]);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.reorderClassifyRules(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classifyRules'] }),
  });

  const moveInOrder = (fromId: number, toId: number): number[] => {
    if (fromId === toId) return order;
    const next = order.filter((id) => id !== fromId);
    const idx = next.indexOf(toId);
    next.splice(idx, 0, fromId);
    return next;
  };

  const ruleById = new Map((rules.data ?? []).map((r) => [r.id, r]));
  const orderedRules = order
    .map((id) => ruleById.get(id))
    .filter((r): r is ClassifyRule => Boolean(r));

  return (
    <section className="settings-section">
      <h4>분류 · 태깅 규칙</h4>
      <p className="muted small">
        정규식 스택으로 파일명을 매칭해 <strong>메타(국가·모델·태그·제목)를
        채우고</strong>, 원하면 <strong>파일을 목적지로 이동</strong>합니다. 태깅은
        매칭되는 모든 규칙이 누적되고, 이동은 목적지가 있는 첫 매칭 규칙 기준입니다.
        이미 분류된 파일도 태그가 채워집니다. 원본 내용은 바뀌지 않습니다.
      </p>

      {orderedRules.length > 1 && (
        <p className="muted small">⠿ 핸들을 드래그해 우선순위를 바꿉니다.</p>
      )}
      <ul className="classify-list">
        {orderedRules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            roots={rootList}
            dnd={{
              onDragStart: () => setDragId(r.id),
              onDragEnter: () => {
                if (dragId !== null && dragId !== r.id) {
                  setOverId(r.id);
                  setOrder(moveInOrder(dragId, r.id));
                }
              },
              onDrop: () => {
                if (dragId !== null) reorder.mutate(order);
                setDragId(null);
                setOverId(null);
              },
              onDragEnd: () => {
                setDragId(null);
                setOverId(null);
              },
              isTarget: overId === r.id,
              isDragging: dragId === r.id,
            }}
          />
        ))}
        {rules.data && rules.data.length === 0 && (
          <li className="muted small">규칙이 없습니다.</li>
        )}
      </ul>

      <AddRule roots={rootList} />

      <BackupSection />

      <details className="classify-target">
        <summary>
          대상 폴더:{' '}
          <strong>{targetPath ? folderTail(targetPath) : '전체'}</strong>
          {targetPath && (
            <button
              type="button"
              className="ghost"
              onClick={(e) => {
                e.preventDefault();
                setTargetPath(undefined);
              }}
              title="대상 폴더 해제 (전체)"
            >
              ✕
            </button>
          )}
        </summary>
        <p className="muted small">
          선택한 폴더 하위 아카이브에만 아래 미리보기·적용이 실행됩니다. (규칙 자체의
          루트 지정과 별개 — 이건 이번 실행 범위)
        </p>
        <PathBrowser selectedPath={targetPath} onSelect={setTargetPath} />
      </details>

      <div className="auto-tag-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => previewMut.mutate()}
          disabled={previewMut.isPending}
        >
          {previewMut.isPending ? '집계 중…' : '미리보기 (활성 규칙 전체)'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `활성 규칙 전체를 적용합니다 (대상: ${targetPath ? folderTail(targetPath) : '전체'}). 메타/태그가 채워지고, 목적지가 지정된 규칙은 파일을 이동합니다.`,
              )
            ) {
              applyMut.mutate();
            }
          }}
          disabled={applyMut.isPending || jobActive(job?.status)}
        >
          전체 적용
        </button>
      </div>

      {previewMut.isError && (
        <p className="error small">{(previewMut.error as Error).message}</p>
      )}

      {preview && (
        <div className="auto-tag-preview">
          <p className="small">
            대상 <strong>{preview.total}</strong>건 — 태깅{' '}
            <strong>{preview.willTag}</strong>건 · 이동{' '}
            <strong>{preview.willMove}</strong>건 / 샘플 {preview.sampled}건
          </p>
          <ul className="auto-tag-list">
            {preview.items.slice(0, 15).map((it) => (
              <li key={it.archiveId} className={it.status}>
                <div className="auto-tag-name" title={it.currentPath}>
                  {it.fileName}
                </div>
                <div className="auto-tag-chips">
                  <span className={`suggest-chip status-${it.status}`}>
                    {STATUS_LABEL[it.status] ?? it.status}
                  </span>
                  {it.tagChanges.map((c, i) => (
                    <span key={i} className="suggest-chip new">
                      {c}
                    </span>
                  ))}
                  {it.ruleName && (
                    <span className="muted small">[{it.ruleName}]</span>
                  )}
                  <span
                    className="classify-root-chip"
                    title={it.rootPath}
                  >
                    🗂 {it.rootLabel ?? rootName(it.rootPath)}
                  </span>
                  {it.destRel && it.status !== 'none' && (
                    <span className="classify-destrel" title={it.destPath ?? ''}>
                      → {it.destRel}/
                    </span>
                  )}
                  {it.message && (
                    <span className="muted small">{it.message}</span>
                  )}
                </div>
              </li>
            ))}
            {preview.items.length > 15 && (
              <li className="muted small">
                … 외 {preview.items.length - 15}건 (샘플)
              </li>
            )}
            {preview.items.length === 0 && (
              <li className="muted small">변경 대상이 없습니다.</li>
            )}
          </ul>
        </div>
      )}

      {job && job.status !== 'done' && job.status !== 'failed' && (
        <div className="job">
          분류 이동 중… {Math.round((job.progress ?? 0) * 100)}%
        </div>
      )}
      {job?.status === 'done' && <MoveStats payload={job.payload} />}
      {job?.status === 'failed' && (
        <p className="error small">실패: {job.error}</p>
      )}

      <HistorySection />
    </section>
  );
}

function MoveStats({ payload }: { payload: string | undefined | null }) {
  const stats = parseStats(payload);
  if (!stats) return <div className="job done">완료 ✓</div>;
  return (
    <div className="job done">
      완료 — 태깅 {stats.tagged} · 이동 {stats.moved} · 충돌 {stats.conflicts} ·
      오류 {stats.errors} · 제자리 {stats.noop}
      {stats.remaining > 0 && (
        <span className="classify-backlog">
          {' '}
          · 다음 실행 대기 <strong>{stats.remaining}</strong>건 (배치 한도)
        </span>
      )}
    </div>
  );
}

function jobActive(s: string | undefined): boolean {
  return s !== undefined && s !== 'done' && s !== 'failed';
}

function toForm(rule: ClassifyRule): ClassifyRuleInput {
  return {
    name: rule.name,
    priority: rule.priority,
    enabled: rule.enabled,
    rootId: rule.rootId,
    matchType: rule.matchType,
    pattern: rule.pattern,
    destTemplate: rule.destTemplate,
    scanCron: rule.scanCron,
    scheduleOn: rule.scheduleOn,
    batchLimit: rule.batchLimit,
    assignments: rule.assignments ?? [],
  };
}

function parseStats(payload: string | undefined | null): {
  tagged: number;
  moved: number;
  conflicts: number;
  errors: number;
  noop: number;
  remaining: number;
} | null {
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload) as {
      stats?: {
        tagged?: number;
        moved?: number;
        conflicts?: number;
        errors?: number;
        noop?: number;
        remaining?: number;
      };
    };
    if (!obj.stats) return null;
    return {
      tagged: obj.stats.tagged ?? 0,
      moved: obj.stats.moved ?? 0,
      conflicts: obj.stats.conflicts ?? 0,
      errors: obj.stats.errors ?? 0,
      noop: obj.stats.noop ?? 0,
      remaining: obj.stats.remaining ?? 0,
    };
  } catch {
    return null;
  }
}
