import { Router } from "express";
import { pool } from "../db";
import { hashPassword } from "../utils/hash";

import { authenticate, AuthRequest } from "../middleware/auth.middleware";
import { allowRoles } from "../middleware/role.middleware";
import { hashAnswer } from "../utils/answerHash";
import { createLog } from "../utils/logger";
const router = Router();

/**
 * CREATE & ACTIVATE QUIZ (ADMIN)
 */
router.post(
  "/quiz",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title required" });
    }

    try {
      const result = await pool.query(
  `
  INSERT INTO quizzes (title, is_active, created_by)
  VALUES ($1, false, $2)
  RETURNING id, title
  `,
  [title, req.user!.id]
);

const quizId = result.rows[0].id;

await createLog({
  action: "QUIZ_CREATED",
  actorRole: req.user!.role,
  actorId: req.user!.id,
  targetType: "QUIZ",
  targetId: quizId,
  status: "SUCCESS",
  message: "Quiz created as draft",
  metadata: { title },
});

res.status(201).json(result.rows[0]);

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create quiz" });
    }
  }
);


/**
 * ADD QUESTION TO ACTIVE QUIZ (ADMIN)
 */
router.post(
  "/question",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const { quizId, question, options, correctOption } = req.body;

    if (
      !quizId ||
      !question ||
      !Array.isArray(options) ||
      options.length !== 4 ||
      !correctOption
    ) {
      return res.status(400).json({ message: "Invalid question data" });
    }

    try {
      const quizCheck = await pool.query(
  `SELECT id, is_active FROM quizzes WHERE id = $1`,
  [quizId]
);

if (quizCheck.rows[0].is_active) {
  return res.status(400).json({
    message: "Cannot add questions after quiz is published"
  });
}


      const correctHash = hashAnswer(correctOption);

      await pool.query(
        `INSERT INTO questions
         (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          quizId,
          question,
          options[0],
          options[1],
          options[2],
          options[3],
          correctHash
        ]
      );

      res.status(201).json({ message: "Question added" });
    } catch {
      res.status(500).json({ message: "Failed to add question" });
    }
  }
);
/**
 * PUBLISH QUIZ (ONE-WAY)
 */
router.patch(
  "/quiz/:quizId/publish",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const quizId = Number(req.params.quizId);
    const { targetClass, publishAt } = req.body;

    if (!quizId || !targetClass || !publishAt) {
      return res.status(400).json({
        message: "quizId, targetClass and publishAt are required",
      });
    }

   const publishTime = new Date(
  new Date(publishAt).toISOString()
);


    if (isNaN(publishTime.getTime())) {
      return res.status(400).json({
        message: "Invalid publishAt datetime",
      });
    }

    // quiz visible only for 1 hour
    const visibleUntil = new Date(
      publishTime.getTime() + 60 * 60 * 1000
    );

    try {
      const quizRes = await pool.query(
        `SELECT is_active FROM quizzes WHERE id = $1`,
        [quizId]
      );

      if (quizRes.rowCount === 0) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      if (quizRes.rows[0].is_active) {
        return res.status(400).json({
          message: "Quiz already published",
        });
      }

      // ⚠️ IMPORTANT:
      // DO NOT set is_active = true here
      await pool.query(
        `
        UPDATE quizzes
        SET
          publish_at = $1,
          visible_until = $2,
          target_class = $3,
          is_active = false
        WHERE id = $4
        `,
        [publishTime, visibleUntil, targetClass, quizId]
      );
      

      return res.json({
        message: "Quiz scheduled successfully",
        publishAt: publishTime,
        visibleUntil,
        targetClass,
      });
    } catch (err) {
      console.error("PUBLISH QUIZ ERROR:", err);
      return res
        .status(500)
        .json({ message: "Failed to publish quiz" });
    }
  }
);


/**
 * GET QUESTIONS BY QUIZ
 */
router.get(
  "/quiz/:quizId/questions",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const quizId = Number(req.params.quizId);

    try {
      const result = await pool.query(
        `SELECT id, question_text,
                option_a, option_b, option_c, option_d
         FROM questions
         WHERE quiz_id = $1
         ORDER BY id`,
        [quizId]
      );

      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch questions" });
    }
  }
);
/**
 * UPDATE QUESTION
 */
router.put(
  "/question/:id",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { question, options, correctOption } = req.body;

    try {
      // 🚫 BLOCK EDIT IF QUIZ IS PUBLISHED
      const quizCheck = await pool.query(
        `
        SELECT q.is_active
        FROM quizzes q
        JOIN questions qs ON qs.quiz_id = q.id
        WHERE qs.id = $1
        `,
        [id]
      );

      if (quizCheck.rowCount === 0) {
        return res.status(404).json({ message: "Question not found" });
      }

      if (quizCheck.rows[0].is_active) {
        return res.status(400).json({
          message: "Cannot edit questions after quiz is published"
        });
      }

      // ✅ UPDATE QUESTION (DRAFT ONLY)
      await pool.query(
        `
        UPDATE questions
        SET question_text = $1,
            option_a = $2,
            option_b = $3,
            option_c = $4,
            option_d = $5,
            correct_answer_hash = $6
        WHERE id = $7
        `,
        [
          question,
          options[0],
          options[1],
          options[2],
          options[3],
          hashAnswer(correctOption),
          id
        ]
      );

      res.json({ message: "Question updated" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update question" });
    }
  }
);

/**
 * DELETE QUESTION
 */

router.delete(
  "/question/:id",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const questionId = Number(req.params.id);

    try {
      // 🔍 Check quiz state & submissions
      const check = await pool.query(
        `
        SELECT 
          qz.is_active,
          EXISTS (
            SELECT 1 FROM results r WHERE r.quiz_id = qz.id
          ) AS has_submissions
        FROM questions qs
        JOIN quizzes qz ON qs.quiz_id = qz.id
        WHERE qs.id = $1
        `,
        [questionId]
      );

      if (check.rowCount === 0) {
        return res.status(404).json({ message: "Question not found" });
      }

      const { is_active, has_submissions } = check.rows[0];

      // 🚫 BLOCK IF PUBLISHED
      if (is_active) {
        return res.status(400).json({
          message: "Cannot delete question after quiz is published"
        });
      }

      // 🚫 BLOCK IF STUDENTS SUBMITTED
      if (has_submissions) {
        return res.status(400).json({
          message: "Cannot delete question after quiz submissions"
        });
      }

      // ✅ SAFE TO DELETE
      await pool.query(
        `DELETE FROM questions WHERE id = $1`,
        [questionId]
      );

      res.json({ message: "Question deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete question" });
    }
  }
);

/**
 * DELETE QUIZ
 */
router.delete(
  "/quiz/:id",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const quizId = Number(req.params.id);
    const quiz = await pool.query(
  "SELECT is_active FROM quizzes WHERE id = $1",
  [quizId]
);

if (quiz.rows[0]?.is_active) {
  return res.status(400).json({
    message: "Published quiz cannot be deleted"
  });
}

    try {
      // Prevent delete if students attempted quiz
      const check = await pool.query(
        `SELECT 1 FROM results WHERE quiz_id = $1`,
        [quizId]
      );

      if ((check.rowCount ?? 0) > 0) {
        return res.status(400).json({
          message: "Cannot delete quiz with student submissions"
        });
      }

      // Delete questions first (FK safety)
      await pool.query(
        `DELETE FROM questions WHERE quiz_id = $1`,
        [quizId]
      );

      await pool.query(
        `DELETE FROM quizzes WHERE id = $1`,
        [quizId]
      );
      await createLog({
  action: "QUIZ_DELETED",
  actorRole: req.user!.role,
  actorId: req.user!.id,
  targetType: "QUIZ",
  targetId: quizId,
  status: "SUCCESS",
  message: "Quiz deleted",
});


      res.json({ message: "Quiz deleted" });
    } catch {
      res.status(500).json({ message: "Failed to delete quiz" });
    }
  }
);

/**
 * ADD SINGLE STUDENT (ADMIN)
 */
router.post(
  "/student",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email required" });
    }

    try {
      // password = student name
      const passwordHash = await hashPassword(name);

      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'STUDENT')
         RETURNING id, name, email`,
        [name, email, passwordHash]
      );

      res.status(201).json({
        message: "Student created",
        student: result.rows[0]
      });
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(400).json({ message: "Email already exists" });
      }

      console.error(err);
      res.status(500).json({ message: "Failed to create student" });
    }
  }
);


/**
 * VIEW RESULTS OF ACTIVE QUIZ (ADMIN)
 */
router.get(
  "/results",
  authenticate,
  allowRoles("ADMIN"),
  async (_req: AuthRequest, res) => {
    try {
      const quizRes = await pool.query(
        `SELECT id, title FROM quizzes WHERE is_active = true LIMIT 1`
      );

      if (quizRes.rowCount === 0) {
        return res.status(400).json({ message: "No active quiz" });
      }

      const quizId = quizRes.rows[0].id;

      const resultsRes = await pool.query(
        `SELECT 
           u.id AS student_id,
           u.name AS student_name,
           u.email,
           r.score,
           r.total,
           r.submitted_at
         FROM results r
         JOIN users u ON r.student_id = u.id
         WHERE r.quiz_id = $1
         ORDER BY r.score DESC`,
        [quizId]
      );

      res.json({
        quiz: quizRes.rows[0],
        results: resultsRes.rows
      });
    } catch {
      res.status(500).json({ message: "Failed to fetch results" });
    }
  }
);
/**
 * GET ALL QUIZZES (ADMIN)
 */
router.get(
  "/quizzes",
  authenticate,
  allowRoles("ADMIN"),
  async (req, res) => {
    const quizzes = await pool.query(`
      SELECT q.*,
      EXISTS (
        SELECT 1 FROM results r WHERE r.quiz_id = q.id
      ) AS has_submissions
      FROM quizzes q
      ORDER BY q.created_at DESC
    `);
    res.json(quizzes.rows);
  }
);




export default router;
