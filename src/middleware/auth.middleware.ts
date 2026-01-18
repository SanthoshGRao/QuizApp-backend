import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Multer } from "multer";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    role: "ADMIN" | "STUDENT";
  };
  file?: Express.Multer.File;
}

const JWT_SECRET = process.env.JWT_SECRET || "secret";

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  // ✅ ALLOW CORS PREFLIGHT
  if (req.method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: number;
      role: "ADMIN" | "STUDENT";
    };

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};
