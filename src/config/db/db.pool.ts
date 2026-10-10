import { Pool } from 'pg';
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS),
});

pool.on('error', (error) => {
  // Idle client errors are emitted here; never log credentials or connection strings.
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

export async function testDatabaseConnection(): Promise<void> {
  const result = await pool.query("SELECT NOW() AS current_time");

  console.log("PostgreSQL connected successfully!");
  console.log("Database time:", result.rows[0].current_time);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
