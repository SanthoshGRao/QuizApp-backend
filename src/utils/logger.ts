import { pool } from "../db";

interface LogInput {
  action: string;
  actorRole?: string;
  actorId?: number;
  targetType?: string;
  targetId?: number;
  status: "SUCCESS" | "FAILED" | "INFO";
  message: string;
  metadata?: any;
}

export const createLog = async (log: LogInput) => {
  await pool.query(
    `
    INSERT INTO system_logs
      (action, actor_role, actor_id, target_type, target_id, status, message, metadata)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      log.action,
      log.actorRole ?? null,
      log.actorId ?? null,
      log.targetType ?? null,
      log.targetId ?? null,
      log.status,
      log.message,
      log.metadata ? JSON.stringify(log.metadata) : null,
    ]
  );
};
