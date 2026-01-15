import { Router } from "express";
import { pool } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";
import { allowRoles } from "../middleware/role.middleware";
import { hashPassword } from "../utils/hash";

const router = Router();

/**
 * ADD SINGLE STUDENT (ADMIN)
 */
router.post(
  "/students",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Missing fields" });
    }

    try {
      // default password = student name
      const passwordHash = await hashPassword(name);

      await pool.query(
  `
  INSERT INTO users (name, email, password_hash, role, must_change_password)
  VALUES ($1, $2, $3, 'STUDENT', true)
  `,
  [name, email.toLowerCase(), passwordHash]
);


      res.status(201).json({ message: "Student added successfully" });
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(400).json({ message: "Email already exists" });
      }
      res.status(500).json({ message: "Failed to add student" });
    }
  }
);

export default router;
