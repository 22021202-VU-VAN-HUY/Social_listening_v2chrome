import type { ApiConfig } from "./config.js";
import type { Database } from "./db.js";

export interface AppContext {
  config: ApiConfig;
  database: Database;
}
