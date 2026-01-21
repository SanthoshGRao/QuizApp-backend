import { Router } from "express";
import { pool } from "../db";
import { hashPassword, comparePassword } from "../utils/hash";
import { generateToken } from "../utils/jwt";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";
import crypto from "crypto";
import { sendResetEmail } from "../utils/mailer";
import { allowRoles } from "../middleware/role.middleware";
import { createLog } from "../utils/logger";

const router = Router();

/**
 * FORGOT PASSWORD
 */
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  const normalizedEmail = email.toLowerCase();

  const userRes = await pool.query(
    `SELECT id FROM users WHERE email = $1`,
    [normalizedEmail]
  );

  // 🔐 SECURITY: Always return same response
  if (userRes.rowCount === 0) {
    return res.json({
      message: "If an account exists for this email, a reset link has been sent",
    });
  }

  // ✅ ONLY runs if user EXISTS
  const userId = userRes.rows[0].id;

  const token = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await pool.query(
    `
    UPDATE users
    SET reset_token = $1,
        reset_token_expiry = $2
    WHERE id = $3
    `,
    [token, expiry, userId]
  );

  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  // ✅ MAIL IS SENT ONLY HERE
  await sendResetEmail(normalizedEmail, resetLink);

  return res.json({
    message: "If an account exists for this email, a reset link has been sent",
  });
});


/**
 * RESET PASSWORD (TOKEN)
 */
router.post("/reset-password-token", async (req, res) => {
  console.log("RESET TOKEN BODY 👉", req.body);
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ message: "Invalid request" });
  }

  const userRes = await pool.query(
    `
    SELECT id FROM users
    WHERE reset_token = $1
      AND reset_token_expiry > NOW()
    `,
    [token]
  );

  if (userRes.rowCount === 0) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  const hash = await hashPassword(newPassword);

  await pool.query(
    `
    UPDATE users
    SET password_hash = $1,
        reset_token = NULL,
        reset_token_expiry = NULL
    WHERE id = $2
    `,
    [hash, userRes.rows[0].id]
  );

  res.json({ message: "Password reset successful" });
});


/**
 * =========================
 * LOGIN (ADMIN / STUDENT)
 * =========================
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const normalizedEmail = email.toLowerCase();

    const result = await pool.query(
      `
      SELECT id, name, email, role, password_hash, must_change_password
      FROM users
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      await createLog({
        action: "LOGIN",
        actorRole: "UNKNOWN",
        status: "FAILED",
        message: `Login failed for ${normalizedEmail}`,
      });

      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken({
      id: user.id,
      role: user.role,
    });

    await createLog({
      action: "LOGIN",
      actorRole: user.role,
      actorId: user.id,
      status: "SUCCESS",
      message: "User logged in",
    });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        mustChangePassword: user.must_change_password,
      },
    });

  } catch (err) {
    console.error("LOGIN ERROR 👉", err);
    res.status(500).json({ message: "Login failed" });
  }
});

/**
 * =========================
 * REGISTER (STUDENT ONLY)
 * =========================
 */
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role, must_change_password)
      VALUES ($1, $2, $3, 'STUDENT', true)
      RETURNING id, name, email, role
      `,
      [name, normalizedEmail, passwordHash]
    );

    res.status(201).json({
      message: "Student registered successfully",
      user: result.rows[0],
    });
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(400).json({ message: "Email already exists" });
    }

    console.error("REGISTER ERROR 👉", err);
    res.status(500).json({ message: "Registration failed" });
  }
});

/**
 * =========================
 * RESET PASSWORD (FIRST LOGIN)
 * =========================
 */
router.put("/reset-password", authenticate, async (req: AuthRequest, res) => {
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Password too short" });
  }

  try {
    const passwordHash = await hashPassword(newPassword);

    await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          must_change_password = false
      WHERE id = $2
      `,
      [passwordHash, req.user!.id]
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("RESET PASSWORD ERROR 👉", err);
    res.status(500).json({ message: "Password reset failed" });
  }
});

router.get(
  "/logs",
  authenticate,
  allowRoles("ADMIN"),
  async (req, res) => {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM system_logs
      ORDER BY created_at DESC
      LIMIT 200
      `
    );

    res.json(rows);
  }
);


export default router;
