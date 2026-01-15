import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { allowRoles } from "../middleware/role.middleware";

const router = Router();

router.get(
  "/admin-only",
  authenticate,
  allowRoles("ADMIN"),
  (_req, res) => {
    res.json({ message: "Welcome Admin" });
  }
);

router.get(
  "/student-only",
  authenticate,
  allowRoles("STUDENT"),
  (_req, res) => {
    res.json({ message: "Welcome Student" });
  }
);

export default router;
