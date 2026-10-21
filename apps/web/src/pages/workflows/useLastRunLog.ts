import { useEffect, useState } from 'react';
import type { ExecutionLog } from '@st/shared';
import { executionsApi } from '../../api.js';
import { useChatRunOf } from '../../stores/chatRuns.js';

/** The log of the open chat's latest run of the workflow, fetched when that run changes; silent (a missing log is just none). */
export function useLastRunLog(workflowId: string | undefined): ExecutionLog | undefined {
  const executionId = useChatRunOf(workflowId);
  const [log, setLog] = useState<ExecutionLog>();
  useEffect(() => {
    if (!executionId) return setLog(undefined);
    let active = true;
    executionsApi
      .get(executionId, { silent: true })
      .then((found) => active && setLog(found))
      .catch(() => active && setLog(undefined));
    return () => {
      active = false;
    };
  }, [executionId]);
  return log;
}
