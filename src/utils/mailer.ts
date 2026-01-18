import nodemailer from "nodemailer";


export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false, // TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendResetEmail(
  to: string,
  resetLink: string
) {
  await transporter.sendMail({
    from: `"Quiz App" <${process.env.SMTP_USER}>`,
    to,
    subject: "Reset your password",
    html: `
      <div style="font-family:Arial">
        <h2>Password Reset</h2>
        <p>Click the link below to reset your password:</p>
        <a href="${resetLink}">Reset Password</a>
        <p>This link expires in 15 minutes.</p>
      </div>
    `,
  });
}
