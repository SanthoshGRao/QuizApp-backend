import express from "express";
import cors from "cors";
import "./db";
import { initDB } from "./db/init";

import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import adminStudentsRoutes from "./routes/admin.students.routes";
import studentRoutes from "./routes/student.routes";

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://santhoshgrao.github.io",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server, Render health checks, Postman
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // ⚠️ IMPORTANT: DO NOT THROW ERROR
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


/* ✅ BODY PARSER */
app.use(express.json());

/* ✅ INIT DB */
initDB();

/* ✅ ROUTES */
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminStudentsRoutes);
app.use("/api/student", studentRoutes);

export default app;
