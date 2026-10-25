import { Router } from "express";
import { count, sql } from "drizzle-orm";
import { tasks } from "../../core/db/schema.js";
import { success } from "../../core/http/responses.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";
import type { Db } from "../../core/db/client.js";
import { and, desc, eq, gte } from "drizzle-orm";

export const dashboardRouter = Router();

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function countWhere(db: Db, userId: string, extra?: ReturnType<typeof sql>): number {
  const conditions = [eq(tasks.userId, userId)];
  if (extra) conditions.push(extra);
  const row = db
    .select({ value: count() })
    .from(tasks)
    .where(and(...conditions))
    .get();
  return Number(row?.value ?? 0);
}

/** Dashboard analytics over the caller's tasks (not workspace-scoped, like the Python source). */
export function getAnalytics(db: Db, userId: string): Record<string, unknown> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60_1000).toISOString();

  const totalTasks = countWhere(db, userId);
  const activeRuns = db
    .select({ value: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        sql`${tasks.status} IN ('queued','running')`,
      ),
    )
    .get();
  const completedToday = db
    .select({ value: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.status, "completed"),
        sql`date(${tasks.createdAt}) = date('now')`,
      ),
    )
    .get();
  const failed = countWhere(db, userId, eq(tasks.status, "failed"));

  const execRows = db
    .select({
      dayIdx: sql<number>`cast(strftime('%w', ${tasks.createdAt}) as integer)`,
      tasks: count(),
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.createdAt, sevenDaysAgo)))
    .groupBy(sql`cast(strftime('%w', ${tasks.createdAt}) as integer)`)
    .orderBy(sql`cast(strftime('%w', ${tasks.createdAt}) as integer)`)
    .all();

  const statusRows = db
    .select({
      date: sql<string>`date(${tasks.createdAt})`,
      successful: sql<number>`SUM(CASE WHEN ${tasks.status} = 'completed' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${tasks.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.createdAt, sevenDaysAgo)))
    .groupBy(sql`date(${tasks.createdAt})`)
    .orderBy(sql`date(${tasks.createdAt})`)
    .all();

  const recentRows = db
    .select({ id: tasks.id, url: tasks.url, status: tasks.status, createdAt: tasks.createdAt })
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.createdAt))
    .limit(5)
    .all();

  return {
    stats: {
      total_tasks: totalTasks,
      active_runs: Number(activeRuns?.value ?? 0),
      completed_today: Number(completedToday?.value ?? 0),
      failed,
    },
    execution_chart: execRows.map((row) => ({ day: DAYS[row.dayIdx] ?? "", tasks: Number(row.tasks) })),
    run_status_chart: statusRows.map((row) => ({
      date: row.date,
      successful: Number(row.successful),
      failed: Number(row.failed),
    })),
    recent_tasks: recentRows.map((row) => ({
      id: row.id,
      endpoint: row.url ?? "",
      status: row.status ?? "",
      scheduled: row.createdAt ?? "",
    })),
  };
}

dashboardRouter.get("/api/analytics", requireJwt(), (req, res) => {
  res.json(success(getAnalytics(req.ctx.db, currentUser(req).id)));
});

