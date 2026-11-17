import { execSync } from "node:child_process";

/** Rebuilds the test database from migrations + seed before the DB suite runs. */
export default function setup() {
  if (process.env.SKIP_DB_SETUP === "1") return;
  execSync("bash scripts/db-test-setup.sh", {
    stdio: "inherit",
    env: {
      ...process.env,
      DB_SUPERUSER_URL: process.env.DB_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/postgres",
    },
  });
}
