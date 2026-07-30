import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Database, Transaction } from "./db.js";
import { ApiError } from "./errors.js";

const pairingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomPairingCode(): string {
  let value = "";
  for (let index = 0; index < 8; index += 1) {
    value += pairingAlphabet[randomInt(0, pairingAlphabet.length)];
  }
  return value;
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secretMatches(raw: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(raw), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "DEVICE_AUTH_REQUIRED", "A device bearer token is required");
  }
  return authorization.slice("Bearer ".length);
}

export async function authenticateDevice(
  database: Database | Transaction,
  request: FastifyRequest,
  expectedDeviceId?: string,
): Promise<{ id: string; workspaceId: string }> {
  const tokenHash = hashSecret(bearerToken(request));
  const result = await database.query<{
    id: string;
    workspace_id: string;
  }>(
    `
      SELECT id, workspace_id
      FROM extension_devices
      WHERE token_hash = $1
        AND revoked_at IS NULL
    `,
    [tokenHash],
  );
  const device = result.rows[0];
  if (!device || (expectedDeviceId !== undefined && device.id !== expectedDeviceId)) {
    throw new ApiError(401, "INVALID_DEVICE_TOKEN", "Device token is invalid or revoked");
  }
  return { id: device.id, workspaceId: device.workspace_id };
}
