import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";

export const allowRoles = (...roles: ("ADMIN" | "STUDENT")[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    next();
  };
};
