import { pool } from "./index";

export const initDB = async () => {
  try {
    // USERS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(10) CHECK (role IN ('ADMIN', 'STUDENT')) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // QUIZ
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        is_active BOOLEAN DEFAULT FALSE,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // QUESTIONS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        quiz_id INT REFERENCES quizzes(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_answer_hash TEXT NOT NULL
      );
    `);

    // STUDENT ANSWERS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_answers (
        id SERIAL PRIMARY KEY,
        student_id INT REFERENCES users(id),
        question_id INT REFERENCES questions(id),
        selected_answer_hash TEXT NOT NULL,
        is_correct BOOLEAN NOT NULL
      );
    `);

    // RESULTS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        student_id INT REFERENCES users(id),
        quiz_id INT REFERENCES quizzes(id),
        score INT NOT NULL,
        total INT NOT NULL,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (student_id, quiz_id)
      );
    `);

    console.log("✅ Database tables ready");
  } catch (err) {
    console.error("❌ Error creating tables", err);
    process.exit(1);
  }
};
