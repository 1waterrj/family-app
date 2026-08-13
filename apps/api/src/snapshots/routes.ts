import {
  DashboardSnapshotSchema,
  ParentSnapshotSchema,
} from '@family/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { requestActor } from '../http.js';
import type { SnapshotService } from './service.js';

export interface SnapshotRoutesOptions {
  snapshotService: SnapshotService;
}

export const snapshotRoutes: FastifyPluginAsync<SnapshotRoutesOptions> = async (
  app,
  { snapshotService },
) => {
  app.get('/parent/snapshot', async (request) =>
    ParentSnapshotSchema.parse(
      await snapshotService.getParentSnapshot(requestActor(request)),
    ),
  );

  app.get('/dashboard/snapshot', async (request) =>
    DashboardSnapshotSchema.parse(
      await snapshotService.getDashboardSnapshot(requestActor(request)),
    ),
  );
};
