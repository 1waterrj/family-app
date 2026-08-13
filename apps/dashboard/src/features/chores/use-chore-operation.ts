import { createSecureUuid } from '@family/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChoreOperation<TInput, TResult> {
  idempotencyKey: string;
  execute(input: TInput): Promise<TResult>;
  cancel(): void;
}

class CancelledChoreOperationError extends Error {
  constructor() {
    super('The chore operation was cancelled.');
    this.name = 'CancelledChoreOperationError';
  }
}

export function isCancelledChoreOperation(
  error: unknown,
): error is CancelledChoreOperationError {
  return error instanceof CancelledChoreOperationError;
}

export function useChoreOperation<TInput, TResult>(
  request: (input: TInput, idempotencyKey: string) => Promise<TResult>,
  createId: () => string = createSecureUuid,
) {
  const requestRef = useRef(request);
  requestRef.current = request;
  const operationRef = useRef<ChoreOperation<TInput, TResult> | undefined>(
    undefined,
  );
  const generationRef = useRef(0);
  const [, renderGeneration] = useState(0);

  const begin = useCallback(() => {
    if (operationRef.current) return operationRef.current;
    const generation = ++generationRef.current;
    let cancelled = false;
    const operation: ChoreOperation<TInput, TResult> = {
      idempotencyKey: createId(),
      async execute(input) {
        if (cancelled) throw new CancelledChoreOperationError();
        const result = await requestRef.current(
          input,
          operation.idempotencyKey,
        );
        if (cancelled || generationRef.current !== generation) {
          throw new CancelledChoreOperationError();
        }
        return result;
      },
      cancel() {
        cancelled = true;
      },
    };
    operationRef.current = operation;
    renderGeneration((value) => value + 1);
    return operation;
  }, [createId]);

  const cancel = useCallback(() => {
    operationRef.current?.cancel();
    operationRef.current = undefined;
    generationRef.current += 1;
    renderGeneration((value) => value + 1);
  }, []);

  const complete = useCallback(
    (operation: ChoreOperation<TInput, TResult>) => {
      if (operationRef.current !== operation) return false;
      cancel();
      return true;
    },
    [cancel],
  );

  const isCurrent = useCallback(
    (operation: ChoreOperation<TInput, TResult>) =>
      operationRef.current === operation,
    [],
  );

  useEffect(
    () => () => {
      operationRef.current?.cancel();
      operationRef.current = undefined;
      generationRef.current += 1;
    },
    [],
  );

  return {
    operation: operationRef.current,
    begin,
    cancel,
    complete,
    isCurrent,
  };
}
