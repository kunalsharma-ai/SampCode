import { ForbiddenException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { type AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';

import { AI_TASKS, type AiGateway } from './ai-gateway';
import { type AiUsageRepository } from './ai-usage.repository';

const policySchema = z.object({
  enabled: z.boolean(),
  allowedTasks: z.array(z.enum(AI_TASKS)).max(AI_TASKS.length),
  requestsPerMinute: z.number().int().min(0).max(10_000),
  requestsPerDay: z.number().int().min(0).max(1_000_000),
  /** USD per month, 0 = no cap. */
  monthlyBudgetUsd: z.number().min(0).max(1_000_000),
  redactPii: z.boolean(),
});

const usd = (micro: bigint | number | null | undefined) => Number(micro ?? 0) / 1_000_000;

/** Organization AI settings (administrators) and the usage ledger. */
export class AiSettingsController {
  constructor(
    private readonly gateway: AiGateway,
    private readonly usage: AiUsageRepository,
    private readonly audit: AuditService,
  ) {}

  private static admin(user: AuthUser) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only administrators can see or change AI settings');
  }

  async get(user: AuthUser) {
    AiSettingsController.admin(user);
    const [policy, status] = await Promise.all([this.gateway.policy(user.tenantId), this.gateway.status(user.tenantId)]);
    return {
      policy: { ...policy, monthlyBudgetMicroUsd: undefined, monthlyBudgetUsd: usd(policy.monthlyBudgetMicroUsd) },
      status,
      tasks: AI_TASKS,
    };
  }

  async save(user: AuthUser, body: unknown) {
    AiSettingsController.admin(user);
    const input = parseBody(policySchema, body);
    const before = await this.gateway.policy(user.tenantId);
    const { monthlyBudgetUsd, ...rest } = input;
    await this.usage.savePolicy(user.tenantId, {
      ...rest,
      monthlyBudgetMicroUsd: BigInt(Math.round(monthlyBudgetUsd * 1_000_000)),
      updatedById: user.id,
    });
    await this.audit.record(user, 'organization.ai_policy', 'tenant', user.tenantId, {
      before: { ...before, monthlyBudgetMicroUsd: String(before.monthlyBudgetMicroUsd) },
      after: input,
    });
    return this.get(user);
  }

  /** This month's usage by task, model and outcome, plus the most recent calls. */
  async usageSummary(user: AuthUser) {
    AiSettingsController.admin(user);
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [rows, recent] = await Promise.all([this.usage.summary(user.tenantId, since), this.usage.recent(user.tenantId, 50)]);
    const groups = rows.map((r) => ({
      task: r.task,
      model: r.model,
      outcome: r.outcome,
      calls: r._count._all,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      cacheReadTokens: r._sum.cacheReadTokens ?? 0,
      cacheWriteTokens: r._sum.cacheWriteTokens ?? 0,
      costUsd: usd(r._sum.costMicroUsd),
    }));
    return {
      since,
      totalCostUsd: groups.reduce((a, g) => a + g.costUsd, 0),
      totalCalls: groups.reduce((a, g) => a + g.calls, 0),
      groups,
      recent: recent.map((r) => ({ ...r, costMicroUsd: undefined, costUsd: usd(r.costMicroUsd) })),
    };
  }
}

/** Express routes of AiSettingsController (mounted by src/http/app.ts). */
export function aiSettingsControllerRoutes(r: Router, c: AiSettingsController, kit: RouteKit) {
  r.get(
    '/api/organization/ai',
    ...kit.route({ controller: 'AiSettingsController', handler: 'get', method: 'get' }, (req) => c.get(req.user as AuthUser)),
  );
  r.put(
    '/api/organization/ai',
    ...kit.route({ controller: 'AiSettingsController', handler: 'save', method: 'put' }, (req) => c.save(req.user as AuthUser, req.body)),
  );
  r.get(
    '/api/organization/ai/usage',
    ...kit.route({ controller: 'AiSettingsController', handler: 'usageSummary', method: 'get' }, (req) =>
      c.usageSummary(req.user as AuthUser),
    ),
  );
}
