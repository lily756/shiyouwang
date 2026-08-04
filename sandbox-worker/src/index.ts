import { getSandbox, Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";

// The class export is required by the Sandbox SDK / Wrangler container binding.
// Internet egress is enabled explicitly so the remote execution mode has the
// same outbound-network behavior as local Docker NAT mode.
export class Sandbox extends CloudflareSandbox {
  enableInternet = true;
}

type Env = {
  Sandbox: DurableObjectNamespace;
  SANDBOX_API_TOKEN?: string;
};

const MAX_CODE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TRANSFER_FILE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 64 * 1024;
const ALLOWED_GIT_OPERATIONS = new Set(["status", "diff", "log", "branch", "init", "add", "commit"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function authorized(request: Request, env: Env) {
  const expected = String(env.SANDBOX_API_TOKEN || "");
  const received = request.headers.get("Authorization") || "";
  return Boolean(expected) && received === `Bearer ${expected}`;
}

function safeScope(value: unknown) {
  const scope = String(value || "anonymous")
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .slice(0, 120);
  return scope || "anonymous";
}

function safeRelativePath(value: unknown, allowRoot = false) {
  const raw = String(value || "").trim().replaceAll("\\", "/");
  if (!raw && allowRoot) return ".";
  if (!raw || raw.startsWith("/") || raw.includes("\0")) throw new Error("path must be a relative workspace path");
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("path leaves the workspace");
    parts.push(part);
  }
  const normalized = parts.join("/");
  if (!normalized && allowRoot) return ".";
  if (!normalized) throw new Error("path must name a workspace file or directory");
  return normalized;
}

function workspacePath(value: unknown, allowRoot = false) {
  const relative = safeRelativePath(value, allowRoot);
  return `/workspace/${relative === "." ? "" : relative}`;
}

function shellQuote(value: unknown) {
  return `'${String(value ?? "").replaceAll("'", `'\\''`)}'`;
}

function output(value: unknown) {
  return String(value || "").slice(0, MAX_OUTPUT_CHARS);
}

function base64ByteLength(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    throw new Error("sandbox returned invalid base64 content");
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
}

async function getRequestBody(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be a JSON object");
  return body;
}

async function runPython(request: Request, env: Env) {
  const body = await getRequestBody(request);
  const code = String(body.code || "");
  if (!code.trim()) throw new Error("code is empty");
  if (new TextEncoder().encode(code).byteLength > MAX_CODE_BYTES) throw new Error("code is too large");
  const filename = safeRelativePath(body.filename || "main.py");
  if (!filename.toLocaleLowerCase().endsWith(".py")) throw new Error("filename must end with .py");
  const args = Array.isArray(body.args) ? body.args.slice(0, 32).map((value) => String(value).slice(0, 200)) : [];
  const sandbox = getSandbox(env.Sandbox, `tg-${safeScope(body.scope)}`);
  await sandbox.mkdir("/workspace", { recursive: true });
  await sandbox.writeFile(workspacePath(filename), code);
  const command = ["python", "-I", "-B", workspacePath(filename), ...args].map(shellQuote).join(" ");
  const result = await sandbox.exec(`timeout 20s ${command}`);
  return json({
    ok: result.exitCode === 0,
    mode: "remote",
    isolation: "cloudflare-sandbox",
    filename,
    exitCode: result.exitCode,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
  }, result.exitCode === 0 ? 200 : 422);
}

async function workspaceFiles(request: Request, env: Env) {
  const body = await getRequestBody(request);
  const operation = String(body.operation || "").toLocaleLowerCase();
  const target = workspacePath(body.path || ".", operation === "list" || operation === "mkdir");
  const sandbox = getSandbox(env.Sandbox, `tg-${safeScope(body.scope)}`);
  if (operation === "list") return json({ ok: true, entries: await sandbox.listFiles(target) });
  if (operation === "mkdir") {
    await sandbox.mkdir(target, { recursive: true });
    return json({ ok: true, path: target });
  }
  if (operation === "read_binary") {
    const requestedLimit = Number(body.max_bytes);
    const maxBytes = Number.isFinite(requestedLimit)
      ? Math.min(MAX_TRANSFER_FILE_BYTES, Math.max(16 * 1024, requestedLimit))
      : MAX_TRANSFER_FILE_BYTES;
    const file = await sandbox.readFile(target, { encoding: "base64" }) as unknown;
    const encoded = typeof file === "string"
      ? file
      : file && typeof file === "object" && "content" in file
        ? String((file as { content?: unknown }).content || "")
        : "";
    const bytes = base64ByteLength(encoded);
    if (bytes > maxBytes) throw new Error(`file exceeds ${maxBytes} byte transfer limit`);
    const mimeType = file && typeof file === "object" && "mimeType" in file
      ? String((file as { mimeType?: unknown }).mimeType || "application/octet-stream")
      : "application/octet-stream";
    return json({ ok: true, path: target, encoding: "base64", content: encoded, mimeType, bytes });
  }
  if (operation === "read") {
    const content = await sandbox.readFile(target);
    return json({ ok: true, path: target, content: String(content).slice(0, MAX_FILE_BYTES) });
  }
  if (operation === "write") {
    const content = String(body.content || "");
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new Error("file is too large");
    await sandbox.writeFile(target, content);
    return json({ ok: true, path: target, bytes: content.length });
  }
  throw new Error("operation must be list, read, read_binary, write or mkdir");
}

async function workspaceGit(request: Request, env: Env) {
  const body = await getRequestBody(request);
  const operation = String(body.operation || "").toLocaleLowerCase();
  if (!ALLOWED_GIT_OPERATIONS.has(operation)) throw new Error("git operation is not allowed");
  if (["init", "add", "commit"].includes(operation) && body.confirm !== true) throw new Error("mutating git operations require confirm=true");
  const repoPath = workspacePath(body.repo_path || ".", true);
  const paths = Array.isArray(body.paths) ? body.paths.slice(0, 100).map((value) => safeRelativePath(value, true)) : [];
  let command = "";
  if (operation === "status") command = `git -C ${shellQuote(repoPath)} status --short --branch`;
  else if (operation === "diff") command = `git -C ${shellQuote(repoPath)} diff --stat -- ${paths.map(shellQuote).join(" ")}`;
  else if (operation === "log") command = `git -C ${shellQuote(repoPath)} log --oneline -n 20`;
  else if (operation === "branch") command = `git -C ${shellQuote(repoPath)} branch --list`;
  else if (operation === "init") command = `git -C ${shellQuote(repoPath)} init`;
  else if (operation === "add") command = `git -C ${shellQuote(repoPath)} add -- ${paths.length ? paths.map(shellQuote).join(" ") : "."}`;
  else command = `git -C ${shellQuote(repoPath)} commit -m ${shellQuote(String(body.message || "").slice(0, 200))}`;
  const sandbox = getSandbox(env.Sandbox, `tg-${safeScope(body.scope)}`);
  const result = await sandbox.exec(command);
  return json({ ok: result.exitCode === 0, operation, exitCode: result.exitCode, stdout: output(result.stdout), stderr: output(result.stderr) }, result.exitCode === 0 ? 200 : 422);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return json({ ok: true, service: "role-bot-sandbox" });
    if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
    try {
      if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
      if (url.pathname === "/run/python") return await runPython(request, env);
      if (url.pathname === "/workspace/files") return await workspaceFiles(request, env);
      if (url.pathname === "/workspace/git") return await workspaceGit(request, env);
      return json({ ok: false, error: "not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  },
};
