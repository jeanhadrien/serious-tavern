import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiBody, ValidationIssue } from '@st/shared';
import { workflowsApi } from '../../api.js';

/** Quiet time after the last change before the draft is sent: the engine resolves ports and reads the YAML repositories. */
const DEBOUNCE_MS = 600;

/**
 * The engine's problems with the draft as it stands, kept current while editing. `id` names the open workflow (its
 * answers do not carry over to another one) and `body` is the draft, or undefined with nothing open. The first answer
 * for a workflow is asked at once; later changes wait `DEBOUNCE_MS`. One request is in flight: a newer draft cancels the
 * older request, so a stale answer never shows. Failures are silent here (the next change asks again).
 * `validateNow` asks at once and reports a failure.
 */
export function useDraftValidation(id: string | undefined, body: ApiBody<'validateWorkflowDraft'> | undefined) {
  const [issues, setIssues] = useState<ValidationIssue[]>();
  const key = useMemo(() => (body ? JSON.stringify(body) : undefined), [body]);
  const latest = useRef(body);
  latest.current = body;
  const answered = useRef(false);
  useEffect(() => {
    answered.current = false;
    setIssues(undefined);
  }, [id]);
  useEffect(() => {
    if (key === undefined || !latest.current) return;
    const draft = latest.current;
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        void workflowsApi
          .validateDraft(draft, { silent: true, signal: controller.signal })
          .then((answer) => {
            if (controller.signal.aborted) return;
            answered.current = true;
            setIssues(answer.issues);
          })
          .catch(() => {}),
      answered.current ? DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);
  const validateNow = useCallback(async (): Promise<ValidationIssue[] | undefined> => {
    if (!latest.current) return undefined;
    try {
      const answer = await workflowsApi.validateDraft(latest.current);
      answered.current = true;
      setIssues(answer.issues);
      return answer.issues;
    } catch {
      return undefined; // API errors are toasted.
    }
  }, []);
  return { issues, validateNow };
}
