declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    WATERCOOLER_SCHEDULER_TOKEN?: string;
    WATERCOOLER_OWNER_EMAIL?: string;
  }
}
