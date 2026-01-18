import { Router } from "express";
import { pool } from "../db";
import { authenticate } from "../middleware/auth.middleware";
import { allowRoles } from "../middleware/role.middleware";
import { AuthRequest } from "../middleware/auth.middleware";
import { hashAnswer } from "../utils/answerHash";
import { createLog } from "../utils/logger";

const router = Router();

/**
 * GET ACTIVE QUIZ (WITHOUT ANSWERS)
 */
router.get(
  "/quiz",
  authenticate,
  allowRoles("STUDENT"),
  async (_req: AuthRequest, res) => {
    try {
      const quizRes = await pool.query(
        `SELECT id, title FROM quizzes WHERE is_active = true LIMIT 1`
      );

      if (quizRes.rowCount === 0) {
        return res.status(404).json({ message: "No active quiz" });
      }

      const quizId = quizRes.rows[0].id;

      const questionsRes = await pool.query(
        `SELECT id, question_text, option_a, option_b, option_c, option_d
         FROM questions WHERE quiz_id = $1`,
        [quizId]
      );

      res.json({
        quiz: quizRes.rows[0],
        questions: questionsRes.rows
      });
    } catch {
      res.status(500).json({ message: "Failed to fetch quiz" });
    }
  }
);
/**
 * GET ALL QUIZZES (STUDENT)
 */
router.get(
  "/quizzes",
  authenticate,
  allowRoles("STUDENT"),
  async (req: AuthRequest, res) => {
    try {
      const studentId = req.user!.id;
      // ✅ FORCE public.users
      const studentRes = await pool.query(
        `SELECT class FROM public.users WHERE id = $1`,
        [studentId]
      );

      if (studentRes.rowCount === 0) {
        return res.status(404).json({ message: "Student not found" });
      }

      const studentClass = studentRes.rows[0].class;

     const quizzesRes = await pool.query(
  `
  SELECT
    q.id,
    q.title,
    q.publish_at,
    q.visible_until
  FROM quizzes q
  WHERE
    q.target_class = $1
    AND q.publish_at <= NOW()
    AND q.visible_until >= NOW()
    AND NOT EXISTS (
      SELECT 1
      FROM results r
      WHERE r.quiz_id = q.id
        AND r.student_id = $2
    )
  ORDER BY q.publish_at DESC
  `,
  [studentClass, studentId]
);

      console.log("STUDENT CLASS:", studentClass);
      console.log("STUDENT ID:", studentId);
      console.log("QUIZ ROWS:", quizzesRes.rows);


      return res.json(quizzesRes.rows);
    } catch (err) {
      console.error("STUDENT QUIZZES ERROR:", err);
      return res.status(500).json({
        message: "Failed to fetch quizzes",
      });
    }
  }
);

/**
 * GET QUIZ DETAILS (QUESTIONS OR RESULT)
 */
router.get(
  "/quiz/:quizId",
  authenticate,
  allowRoles("STUDENT"),
  async (req: AuthRequest, res) => {
    const quizId = Number(req.params.quizId);

    try {
      // Check submission
      const existing = await pool.query(
        `SELECT score, total
         FROM results
         WHERE student_id = $1 AND quiz_id = $2`,
        [req.user!.id, quizId]
      );

      if ((existing.rowCount ?? 0) > 0) {
        return res.json({
          submitted: true,
          result: existing.rows[0]
        });
      }

      // Not submitted → return questions
      const quiz = await pool.query(
        `SELECT id, title FROM quizzes WHERE id = $1`,
        [quizId]
      );

      if (quiz.rowCount === 0) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      const questions = await pool.query(
        `SELECT id, question_text,
                option_a, option_b, option_c, option_d
         FROM questions
         WHERE quiz_id = $1`,
        [quizId]
      );

      res.json({
        submitted: false,
        quiz: quiz.rows[0],
        questions: questions.rows
      });
    } catch {
      res.status(500).json({ message: "Failed to load quiz" });
    }
  }
);


/**
 * SUBMIT QUIZ
 */
router.post(
  "/submit",
  authenticate,
  allowRoles("STUDENT"),
  async (req: AuthRequest, res) => {
    const { quizId, answers } = req.body;

    if (!quizId || !Array.isArray(answers)) {
      return res.status(400).json({ message: "Invalid submission data" });
    }

    try {
      // 1️⃣ Fetch quiz + publish window
      const quizRes = await pool.query(
        `
        SELECT id, publish_at, visible_until, is_active
        FROM quizzes
        WHERE id = $1
        `,
        [quizId]
      );

      if (quizRes.rowCount === 0) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      const quiz = quizRes.rows[0];
      const now = new Date();

      // 2️⃣ Active check
      if (
        !quiz.publish_at ||
        !quiz.visible_until ||
        now < quiz.publish_at ||
        now > quiz.visible_until
      ) {
        return res.status(403).json({
          message: "Quiz is not available at this time",
        });
      }


      // 3️⃣ Time window enforcement (1 hour)
      if (
        !quiz.publish_at ||
        !quiz.visible_until ||
        now < quiz.publish_at ||
        now > quiz.visible_until
      ) {
        return res.status(403).json({
          message: "Quiz is not available at this time",
        });
      }

      // 4️⃣ Prevent re-submission
      const existing = await pool.query(
        `SELECT 1 FROM results WHERE student_id = $1 AND quiz_id = $2`,
        [req.user!.id, quizId]
      );

      if ((existing.rowCount ?? 0) > 0) {
        return res.status(400).json({
          message: "You have already submitted this quiz",
        });
      }

      // 5️⃣ Evaluate answers
      let score = 0;

      for (const ans of answers) {
        const qRes = await pool.query(
          `
          SELECT correct_answer_hash
          FROM questions
          WHERE id = $1 AND quiz_id = $2
          `,
          [ans.questionId, quizId]
        );

        if (qRes.rowCount === 0) continue;

        const correctHash = qRes.rows[0].correct_answer_hash;
        const selectedHash = hashAnswer(ans.selectedOption);
        const isCorrect = selectedHash === correctHash;

        if (isCorrect) score++;

        await pool.query(
          `
          INSERT INTO student_answers
            (student_id, question_id, selected_answer_hash, is_correct)
          VALUES ($1, $2, $3, $4)
          `,
          [
            req.user!.id,
            ans.questionId,
            selectedHash,
            isCorrect,
          ]
        );
      }

      const total = answers.length;

      // 6️⃣ Save final result
      await pool.query(
        `
        INSERT INTO results (student_id, quiz_id, score, total)
        VALUES ($1, $2, $3, $4)
        `,
        [req.user!.id, quizId, score, total]
      );
      await createLog({
  action: "QUIZ_SUBMITTED",
  actorRole: "STUDENT",
  actorId: req.user!.id,
  targetType: "QUIZ",
  targetId: quizId,
  status: "SUCCESS",
  message: "Student submitted quiz",
  metadata: { score, total },
});


      return res.json({ score, total });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Failed to submit quiz" });
    }
  }
);

/**
 * =========================
 * QUIZ RESULT DETAILS
 * =========================
 */
router.get(
  "/quiz/:quizId/result",
  authenticate,
  allowRoles("STUDENT"),
  async (req: AuthRequest, res) => {
    const quizId = Number(req.params.quizId);
    const studentId = req.user!.id;

    const summary = await pool.query(
      `SELECT score, total FROM results
       WHERE quiz_id = $1 AND student_id = $2`,
      [quizId, studentId]
    );

    if (summary.rowCount === 0) {
      return res.status(404).json({ message: "Result not found" });
    }

    const questions = await pool.query(
      `
      SELECT
        q.id,
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.correct_answer_hash,
        sa.selected_answer_hash,
        sa.is_correct
      FROM questions q
      LEFT JOIN student_answers sa
        ON sa.question_id = q.id
        AND sa.student_id = $1
      WHERE q.quiz_id = $2
      ORDER BY q.id
      `,
      [studentId, quizId]
    );

    res.json({
      score: summary.rows[0].score,
      total: summary.rows[0].total,
      questions: questions.rows,
    });
  }
);

/**
 * =========================
 * STUDENT DASHBOARD
 * =========================
 */
router.get(
  "/dashboard",
  authenticate,
  allowRoles("STUDENT"),
  async (req: AuthRequest, res) => {
    try {
      const studentId = req.user!.id;

      // 1️⃣ Total quizzes (active only)
      const totalRes = await pool.query(
        `SELECT COUNT(*) FROM quizzes WHERE is_active = true`
      );

      // 2️⃣ Completed quizzes
      const completedRes = await pool.query(
        `SELECT COUNT(*) FROM results WHERE student_id = $1`,
        [studentId]
      );

      // 3️⃣ Average score
      const avgRes = await pool.query(
        `
        SELECT COALESCE(ROUND(AVG((score::float / total) * 100)), 0) AS avg
        FROM results
        WHERE student_id = $1
        `,
        [studentId]
      );

      // 4️⃣ Recent activity (SAFE if quiz deleted)
      const recentRes = await pool.query(
        `
        SELECT 
          q.title,
          r.score,
          r.total
        FROM results r
        LEFT JOIN quizzes q ON q.id = r.quiz_id
        WHERE r.student_id = $1
        ORDER BY r.submitted_at DESC
        LIMIT 5
        `,
        [studentId]
      );

      res.json({
        totalQuizzes: Number(totalRes.rows[0].count),
        completed: Number(completedRes.rows[0].count),
        averageScore: Number(avgRes.rows[0].avg),
        recent: recentRes.rows.map((r) => ({
          title: r.title ?? "Deleted Quiz",
          score: r.score,
          total: r.total,
        })),
      });
    } catch (err) {
      console.error("STUDENT DASHBOARD ERROR:", err);
      res.status(500).json({ message: "Failed to load dashboard" });
    }
  }
);
router.get(
  "/results",
  authenticate,
  allowRoles("STUDENT"),
  async (req: AuthRequest, res) => {
    const studentId = req.user!.id;

    const { rows } = await pool.query(
      `
      SELECT
        q.id AS quiz_id,
        q.title,
        r.score,
        r.total,
        r.submitted_at
      FROM results r
      LEFT JOIN quizzes q ON q.id = r.quiz_id
      WHERE r.student_id = $1
      ORDER BY r.submitted_at DESC
      `,
      [studentId]
    );

    res.json(rows);
  }
);
router.post(
  "/violation",
  authenticate,
  allowRoles("STUDENT"),
  async (req: AuthRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { quizId, type } = req.body;

    if (!quizId || !type) {
      return res.status(400).json({ message: "Invalid violation data" });
    }

    await pool.query(
      `
      INSERT INTO quiz_violations (student_id, quiz_id, type)
      VALUES ($1, $2, $3)
      `,
      [req.user.id, quizId, type]
    );

    res.json({ message: "Violation logged" });
  }
);


export default router;
