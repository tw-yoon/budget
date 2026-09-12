/**
 * Stores Plaid access tokens in an AES-256-GCM encrypted file on disk.
 * The file lives at TOKEN_STORE_PATH (default: ./data/tokens.enc) which is
 * gitignored. The encryption key comes from TOKEN_STORE_KEY in .env.local.
 *
 * File format (after decryption): JSON record mapping itemId → accessToken.
 * On-disk format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.TOKEN_STORE_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "TOKEN_STORE_KEY must be a 64-char hex string (32 bytes). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

function getStorePath(): string {
  const p = process.env.TOKEN_STORE_PATH ?? "./data/tokens.enc";
  return path.resolve(process.cwd(), p);
}

function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

function decrypt(data: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function readStore(): Record<string, string> {
  const p = getStorePath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf8").trim();
    return JSON.parse(decrypt(raw));
  } catch {
    throw new Error("Failed to decrypt token store. Check TOKEN_STORE_KEY.");
  }
}

function writeStore(store: Record<string, string>): void {
  const p = getStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, encrypt(JSON.stringify(store)), { mode: 0o600 });
}

export function saveAccessToken(itemId: string, accessToken: string): void {
  const store = readStore();
  store[itemId] = accessToken;
  writeStore(store);
}

export function getAccessToken(itemId: string): string {
  const store = readStore();
  const token = store[itemId];
  if (!token) throw new Error(`No access token found for itemId: ${itemId}`);
  return token;
}

export function deleteAccessToken(itemId: string): void {
  const store = readStore();
  delete store[itemId];
  writeStore(store);
}

export function listItemIds(): string[] {
  return Object.keys(readStore());
}
