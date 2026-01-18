import { Router } from "express";
import { pool } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";
import { allowRoles } from "../middleware/role.middleware";
import { hashPassword } from "../utils/hash";
import multer from "multer";
import csv from "csv-parser";
import fs from "fs";
import XLSX from "xlsx";
import { createLog } from "../utils/logger";


interface StudentInput {
  name: string;
  email: string;
  class: string;
}


const router = Router();
const upload = multer({ dest: "uploads/" });


/**
 * ADD SINGLE STUDENT (ADMIN)
 */
router.post(
  "/students",
  authenticate,
  allowRoles("ADMIN"),
  async (req: AuthRequest, res) => {
    const { name, email, class: studentClass } = req.body;

    if (!name || !email || !studentClass) {
      return res.status(400).json({ message: "Name, email and class are required" });
    }


    try {
      // default password = student name
      const passwordHash = await hashPassword(name);

      await pool.query(
        `
 INSERT INTO users
(name, email, password_hash, role, must_change_password, class)
VALUES ($1, $2, $3, 'STUDENT', true, $4)

  `,
        [name, email.toLowerCase(), passwordHash, studentClass]
      );
      await createLog({
        action: "STUDENT_ADDED",
        actorRole: req.user!.role,
        actorId: req.user!.id,
        targetType: "STUDENT",
        status: "SUCCESS",
        message: "Student added manually",
        metadata: { name, email, class: studentClass },
      });



      res.status(201).json({ message: "Student added successfully" });
    } catch (err: any) {
      await createLog({
        action: "STUDENT_ADD_FAILED",
        actorRole: req.user!.role,
        actorId: req.user!.id,
        targetType: "STUDENT",
        status: "FAILED",
        message: err.code === "23505" ? "Email already exists" : "Add student failed",
        metadata: { name, email, class: studentClass },
      });

      if (err.code === "23505") {
        return res.status(400).json({ message: "Email already exists" });
      }
      res.status(500).json({ message: "Failed to add student" });
    }
  }
);
const insertStudents = async (students: StudentInput[]) => {
  const results: {
    name: string;
    email: string;
    status: "SUCCESS" | "FAILED";
    reason?: string;
  }[] = [];

  for (const s of students) {
    // ✅ 1️⃣ Validate input FIRST (before DB)
    if (!s.name) {
      results.push({
        name: s.name ?? "",
        email: s.email ?? "",
        status: "FAILED",
        reason: "Name missing",
      });
      continue;
    }

    if (!s.email) {
      results.push({
        name: s.name,
        email: "",
        status: "FAILED",
        reason: "Email missing",
      });
      continue;
    }

    if (!s.class) {
      results.push({
        name: s.name,
        email: s.email,
        status: "FAILED",
        reason: "Class missing",
      });
      continue;
    }

    try {
      // ✅ 2️⃣ DB work ONLY after validation
      const passwordHash = await hashPassword(s.name);

      await pool.query(
        `
        INSERT INTO users
          (name, email, password_hash, role, must_change_password, class)
        VALUES
          ($1, $2, $3, 'STUDENT', true, $4)
        `,
        [s.name, s.email, passwordHash, s.class]
      );

      results.push({
        name: s.name,
        email: s.email,
        status: "SUCCESS",
      });
    } catch (err: any) {
      let reason = "Failed to insert student";

      // ✅ DB-specific error only
      if (err.code === "23505") {
        reason = "Email already exists";
      }

      results.push({
        name: s.name,
        email: s.email,
        status: "FAILED",
        reason,
      });
    }
  }

  return results;
};


/**
 * ADD MULTIPLE STUDENTS (CSV UPLOAD)
 */
router.post(
  "/students/bulk",
  authenticate,
  allowRoles("ADMIN"),
  upload.single("file"),
  async (req: AuthRequest, res) => {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "File required" });
    }

    const students: StudentInput[] = [];

    const ext = file.originalname.split(".").pop()?.toLowerCase();

    try {
      if (ext === "csv") {
        await new Promise<void>((resolve, reject) => {
          fs.createReadStream(file.path)
            .pipe(csv())
            .on("data", (row) => {
              const name = String(row.name ?? "").trim();
              const email = String(row.email ?? "").trim().toLowerCase();
              const studentClass = String(row.class ?? "").trim();

              students.push({
                name,
                email,
                class: studentClass,
              });
            })

            .on("end", resolve)
            .on("error", reject);
        });
      }
      else if (ext === "xlsx") {
        const workbook = XLSX.readFile(file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet);

        rows.forEach((row) => {
          students.push({
            name: String(row.name ?? "").trim(),
            email: String(row.email ?? "").trim().toLowerCase(),
            class: String(row.class ?? "").trim(), // allow empty
          });
        });
      }

      else {
        fs.unlinkSync(file.path);
        return res.status(400).json({
          message: "Only CSV or Excel (.xlsx) files are allowed",
        });
      }

      const result = await insertStudents(students);

      // 🔹 LOG EACH RESULT
      for (const r of result) {
        await createLog({
          action: "STUDENT_BULK_ADD",
          actorRole: req.user!.role,
          actorId: req.user!.id,
          targetType: "STUDENT",
          status: r.status,
          message:
            r.status === "SUCCESS"
              ? "Student added via bulk upload"
              : r.reason || "Bulk upload failed",
          metadata: {
            name: r.name,
            email: r.email,
            class: students.find(s => s.email === r.email)?.class ?? null,
          },
        });
      }


      fs.unlinkSync(file.path);


      return res.json({
        message: "Bulk upload completed",
        results: result,
      });

    } catch (err) {
      console.error("BULK UPLOAD ERROR:", err);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(500).json({ message: "Bulk upload failed" });
    }
  }
);

export default router;
