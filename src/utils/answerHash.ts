import crypto from "crypto";

export const hashAnswer = (answer: string) => {
  return crypto
    .createHash("sha256")
    .update(answer)
    .digest("hex");
};
