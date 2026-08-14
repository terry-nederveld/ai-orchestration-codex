import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SecretProvider } from "../../ports/security.js";

interface EncryptedEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class EncryptedFileSecretProvider implements SecretProvider {
  public readonly id = "encrypted-file";
  readonly #path: string;
  readonly #masterPassword: string;
  #writes: Promise<void> = Promise.resolve();

  public constructor(path: string, masterPassword: string) {
    if (masterPassword.length < 16)
      throw new Error("Secret vault master password must be at least 16 characters");
    this.#path = path;
    this.#masterPassword = masterPassword;
  }

  public async available(): Promise<boolean> {
    return this.#masterPassword.length >= 16;
  }

  public async get(reference: string): Promise<string | undefined> {
    return (await this.#read())[reference];
  }

  public async set(reference: string, value: string): Promise<void> {
    await this.#serialized(async () => {
      const secrets = await this.#read();
      secrets[reference] = value;
      await this.#write(secrets);
    });
  }

  public async delete(reference: string): Promise<boolean> {
    let removed = false;
    await this.#serialized(async () => {
      const secrets = await this.#read();
      if (secrets[reference] === undefined) return;
      delete secrets[reference];
      removed = true;
      await this.#write(secrets);
    });
    return removed;
  }

  async #read(): Promise<Record<string, string>> {
    try {
      const status = await lstat(this.#path);
      if (status.isSymbolicLink() || !status.isFile())
        throw new Error("Secret vault must be a regular file");
      const envelope = parseEnvelope(await readFile(this.#path, "utf8"));
      const key = scryptSync(this.#masterPassword, Buffer.from(envelope.salt, "base64"), 32);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return parseSecrets(plaintext);
    } catch (error) {
      if (isMissingFile(error)) return {};
      throw error;
    }
  }

  async #write(secrets: Record<string, string>): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.#masterPassword, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secrets), "utf8"),
      cipher.final(),
    ]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(envelope), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600);
  }

  async #serialized(operation: () => Promise<void>): Promise<void> {
    const next = this.#writes.then(operation, operation);
    this.#writes = next.catch(() => undefined);
    await next;
  }
}

function parseEnvelope(source: string): EncryptedEnvelope {
  const value: unknown = JSON.parse(source);
  if (
    value === null ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("salt" in value) ||
    typeof value.salt !== "string" ||
    !("iv" in value) ||
    typeof value.iv !== "string" ||
    !("tag" in value) ||
    typeof value.tag !== "string" ||
    !("ciphertext" in value) ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("Secret vault has an invalid format");
  }
  return value as EncryptedEnvelope;
}

function parseSecrets(source: string): Record<string, string> {
  const value: unknown = JSON.parse(source);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Decrypted secret vault is invalid");
  }
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => typeof item === "string")) {
    throw new Error("Decrypted secret vault contains an invalid value");
  }
  return Object.fromEntries(entries);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
