import { useEffect, useState } from 'react';
import { Job } from '../api';

/**
 * 단일 작업을 SSE 로 구독한다. jobId 가 null 이면 비활성.
 * 서버는 접속 직후 현재 상태를 한 번 푸시하고, 이후 변경 시마다 푸시한다.
 *
 * SSE 가 사용 불가능한 환경에서도 동작하도록 onerror 시 1초 폴링으로 폴백.
 */
export function useJobStream(jobId: number | null): Job | undefined {
  const [job, setJob] = useState<Job | undefined>(undefined);

  useEffect(() => {
    if (jobId === null) {
      setJob(undefined);
      return;
    }
    let cancelled = false;
    const es = new EventSource(`/api/jobs/stream?ids=${jobId}`);
    let pollTimer: number | undefined;

    const startPolling = () => {
      const tick = () => {
        if (cancelled) return;
        fetch(`/api/jobs/${jobId}`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: Job | null) => {
            if (!cancelled && data) setJob(data);
            if (
              !cancelled &&
              data &&
              data.status !== 'done' &&
              data.status !== 'failed'
            ) {
              pollTimer = window.setTimeout(tick, 1000);
            }
          })
          .catch(() => {
            if (!cancelled) pollTimer = window.setTimeout(tick, 2000);
          });
      };
      tick();
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as Job;
        if (!cancelled) setJob(data);
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      es.close();
      if (!cancelled) startPolling();
    };

    return () => {
      cancelled = true;
      es.close();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [jobId]);

  return job;
}
