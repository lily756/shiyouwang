const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TRANSFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_PYTHON_TIMEOUT_MS = 20_000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeScopePart(value, fallback) {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeRelativePath(value, { allowRoot = false } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw && allowRoot) return ".";
  if (!raw || path.isAbsolute(raw) || raw.includes("\0")) {
    throw new Error("路径必须是工作区内的相对路径。 ");
  }
  const normalized = path.posix.normalize(raw.replaceAll("\\", "/"));
  if (normalized === "." && !allowRoot) {
    throw new Error("必须指定工作区内的文件或目录路径。 ");
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("路径不能离开受控工作区。 ");
  }
  return normalized;
}

function trimOutput(value, maxBytes) {
  const buffer = Buffer.from(String(value || ""), "utf8");
  if (buffer.length <= maxBytes) return buffer.toString("utf8");
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n…（输出已截断）`;
}

function createWorkspaceManager({
  rootDir,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxTransferBytes = DEFAULT_MAX_TRANSFER_BYTES,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  pythonTimeoutMs = DEFAULT_PYTHON_TIMEOUT_MS,
  executionMode = "disabled",
  networkMode = "none",
  dockerImage = "python:3.12-slim",
  remoteUrl = "",
  remoteToken = "",
} = {}) {
  const root = path.resolve(rootDir || path.join(process.cwd(), "agent-workspaces"));
  const fileLimit = clamp(Number(maxFileBytes) || DEFAULT_MAX_FILE_BYTES, 16 * 1024, 20 * 1024 * 1024);
  const transferLimit = clamp(Number(maxTransferBytes) || DEFAULT_MAX_TRANSFER_BYTES, 16 * 1024, 50 * 1024 * 1024);
  const outputLimit = clamp(Number(maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES, 4 * 1024, 512 * 1024);
  const commandLimit = clamp(Number(commandTimeoutMs) || DEFAULT_COMMAND_TIMEOUT_MS, 1_000, 120_000);
  const pythonLimit = clamp(Number(pythonTimeoutMs) || DEFAULT_PYTHON_TIMEOUT_MS, 1_000, 120_000);
  const mode = ["disabled", "docker", "local", "remote"].includes(String(executionMode).toLowerCase())
    ? String(executionMode).toLowerCase()
    : "disabled";
  const dockerNetworkMode = ["none", "nat"].includes(String(networkMode).toLowerCase())
    ? String(networkMode).toLowerCase()
    : "none";
  const sandboxRemoteUrl = String(remoteUrl || "").trim().replace(/\/+$/, "");
  const sandboxRemoteToken = String(remoteToken || "").trim();

  function scopeRoot(scope = {}) {
    const userPart = safeScopePart(scope.userId, "anonymous");
    const chatPart = safeScopePart(scope.chatId, "chat");
    return path.join(root, userPart, chatPart);
  }

  function resolveWithin(scope, relativePath, { allowRoot = false } = {}) {
    const base = scopeRoot(scope);
    const relative = normalizeRelativePath(relativePath, { allowRoot });
    const target = path.resolve(base, relative);
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
      throw new Error("路径不能离开受控工作区。 ");
    }
    return { base, target, relative };
  }

  async function ensureExistingParentsInside(base, target) {
    let current = target;
    while (current !== base && !fs.existsSync(current)) {
      current = path.dirname(current);
    }
    const resolvedBase = await fs.promises.realpath(base);
    const resolvedCurrent = await fs.promises.realpath(current);
    if (resolvedCurrent !== resolvedBase && !resolvedCurrent.startsWith(`${resolvedBase}${path.sep}`)) {
      throw new Error("路径的现有父目录不在受控工作区内。 ");
    }
  }

  async function rejectSymlink(target) {
    try {
      const stat = await fs.promises.lstat(target);
      if (stat.isSymbolicLink()) throw new Error("受控工作区不允许通过符号链接访问文件。 ");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async function ensureWorkspace(scope) {
    const base = scopeRoot(scope);
    await fs.promises.mkdir(base, { recursive: true, mode: 0o700 });
    await ensureExistingParentsInside(base, base);
    return { root: base, relative: "." };
  }

  async function resolveSafe(scope, relativePath, { allowRoot = false, mustExist = false } = {}) {
    const resolved = resolveWithin(scope, relativePath, { allowRoot });
    await ensureWorkspace(scope);
    await ensureExistingParentsInside(resolved.base, resolved.target);
    await rejectSymlink(resolved.target);
    if (mustExist) {
      try {
        await fs.promises.access(resolved.target, fs.constants.F_OK);
      } catch {
        throw new Error(`工作区路径不存在：${resolved.relative}`);
      }
    }
    return resolved;
  }

  async function listFiles({ scope, relativePath = "." } = {}) {
    const resolved = await resolveSafe(scope, relativePath, { allowRoot: true, mustExist: true });
    const stat = await fs.promises.stat(resolved.target);
    if (!stat.isDirectory()) throw new Error("list 操作只能读取目录。 ");
    const entries = await fs.promises.readdir(resolved.target, { withFileTypes: true });
    return entries.slice(0, 500).map((entry) => ({
      path: path.posix.join(resolved.relative === "." ? "" : resolved.relative, entry.name) || ".",
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }));
  }

  async function readFile({ scope, relativePath } = {}) {
    const resolved = await resolveSafe(scope, relativePath, { mustExist: true });
    const stat = await fs.promises.stat(resolved.target);
    if (!stat.isFile()) throw new Error("read 操作只能读取普通文件。 ");
    if (stat.size > fileLimit) throw new Error(`文件超过 ${fileLimit} 字节读取上限。`);
    const content = await fs.promises.readFile(resolved.target, "utf8");
    return { path: resolved.relative, bytes: Buffer.byteLength(content), content };
  }

  async function readFileBuffer({ scope, relativePath, maxBytes = transferLimit } = {}) {
    const requestedLimit = Number(maxBytes) || transferLimit;
    const effectiveLimit = clamp(requestedLimit, 16 * 1024, transferLimit);
    const filenameRelative = normalizeRelativePath(relativePath);
    if (mode === "remote") {
      if (!sandboxRemoteUrl) {
        throw new Error("remote 沙箱未配置 SANDBOX_API_URL。 ");
      }
      const response = await fetch(`${sandboxRemoteUrl}/workspace/files`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(sandboxRemoteToken ? { Authorization: `Bearer ${sandboxRemoteToken}` } : {}),
        },
        body: JSON.stringify({
          operation: "read_binary",
          scope: `${safeScopePart(scope?.userId, "anonymous")}:${safeScopePart(scope?.chatId, "chat")}`,
          path: filenameRelative,
          max_bytes: effectiveLimit,
        }),
        signal: AbortSignal.timeout(commandLimit + 10_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `远程沙箱返回 HTTP ${response.status}。 `);
      }
      if (payload?.encoding !== "base64" || typeof payload.content !== "string") {
        throw new Error("远程沙箱没有返回有效的二进制文件内容。 ");
      }
      const encoded = payload.content.replace(/\s+/g, "");
      if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
        throw new Error("远程沙箱返回的文件内容不是有效的 base64。 ");
      }
      const content = Buffer.from(encoded, "base64");
      if (content.length > effectiveLimit) {
        throw new Error(`文件超过 ${effectiveLimit} 字节发送上限。`);
      }
      return {
        path: filenameRelative,
        bytes: content.length,
        content,
        mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "application/octet-stream",
      };
    }

    const resolved = await resolveSafe(scope, filenameRelative, { mustExist: true });
    const stat = await fs.promises.stat(resolved.target);
    if (!stat.isFile()) throw new Error("send 操作只能发送普通文件。 ");
    if (stat.size > effectiveLimit) throw new Error(`文件超过 ${effectiveLimit} 字节发送上限。`);
    const content = await fs.promises.readFile(resolved.target);
    return { path: resolved.relative, bytes: content.length, content, mimeType: "application/octet-stream" };
  }

  async function writeFile({ scope, relativePath, content } = {}) {
    const resolved = await resolveSafe(scope, relativePath);
    const text = typeof content === "string" ? content : String(content ?? "");
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > fileLimit) throw new Error(`文件超过 ${fileLimit} 字节写入上限。`);
    await fs.promises.mkdir(path.dirname(resolved.target), { recursive: true, mode: 0o700 });
    await ensureExistingParentsInside(resolved.base, resolved.target);
    await rejectSymlink(resolved.target);
    await fs.promises.writeFile(resolved.target, text, { encoding: "utf8", mode: 0o600 });
    return { path: resolved.relative, bytes };
  }

  async function makeDirectory({ scope, relativePath } = {}) {
    const resolved = await resolveSafe(scope, relativePath);
    await fs.promises.mkdir(resolved.target, { recursive: true, mode: 0o700 });
    await ensureExistingParentsInside(resolved.base, resolved.target);
    return { path: resolved.relative };
  }

  async function readAbsoluteFile(absolutePath, { maxBytes = fileLimit } = {}) {
    const target = path.resolve(String(absolutePath || ""));
    const resolvedRoot = await fs.promises.realpath(root);
    const resolvedTarget = await fs.promises.realpath(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("公开文件不在受控工作区内。 ");
    }
    await rejectSymlink(target);
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) throw new Error("公开资源不是普通文件。 ");
    if (stat.size > maxBytes) throw new Error("公开资源超过大小限制。 ");
    return fs.promises.readFile(target);
  }

  function spawnProcess(command, args, {
    cwd,
    timeoutMs = commandLimit,
    maxBytes = outputLimit,
    env = process.env,
  } = {}) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      const child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve({
          ...result,
          stdout: trimOutput(stdout, maxBytes),
          stderr: trimOutput(stderr, maxBytes),
        });
      };
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        finish({ ok: false, exitCode: null, signal: null, timedOut, error: error.message });
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timer);
        finish({ ok: exitCode === 0 && !timedOut, exitCode, signal, timedOut });
      });
    });
  }

  function processEnv(extra = {}) {
    return {
      PATH: process.env.PATH || "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      ...extra,
    };
  }

  async function getGitRoot(cwd) {
    const result = await spawnProcess("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      timeoutMs: commandLimit,
      maxBytes: 8 * 1024,
      env: processEnv(),
    });
    if (!result.ok) return null;
    return result.stdout.trim();
  }

  async function runGit({ scope, operation, repoPath = ".", paths = [], message = "", confirm = false } = {}) {
    const allowedOperations = new Set(["status", "diff", "log", "branch", "init", "add", "commit"]);
    const normalizedOperation = String(operation || "").trim().toLowerCase();
    if (!allowedOperations.has(normalizedOperation)) {
      throw new Error("Git 只允许 status、diff、log、branch、init、add、commit。 ");
    }
    const resolved = await resolveSafe(scope, repoPath, { allowRoot: true, mustExist: normalizedOperation !== "init" });
    const stat = await fs.promises.stat(resolved.target);
    if (!stat.isDirectory()) throw new Error("Git 工作目录必须是目录。 ");
    if (["init", "add", "commit"].includes(normalizedOperation) && confirm !== true) {
      throw new Error("这个 Git 操作会改变工作区，必须显式传入 confirm=true。 ");
    }
    if (normalizedOperation !== "init") {
      const gitRoot = await getGitRoot(resolved.target);
      if (!gitRoot) throw new Error("当前工作区不是 Git 仓库；请先用 init 初始化。 ");
      const realBase = await fs.promises.realpath(resolved.base);
      const realGitRoot = await fs.promises.realpath(gitRoot);
      if (realGitRoot !== realBase && !realGitRoot.startsWith(`${realBase}${path.sep}`)) {
        throw new Error("为避免操作受控工作区外的仓库，已拒绝该 Git 仓库。 ");
      }
    }

    const normalizedPaths = Array.isArray(paths)
      ? paths.slice(0, 100).map((item) => normalizeRelativePath(item, { allowRoot: true }))
      : [];
    let args;
    if (normalizedOperation === "status") args = ["status", "--short", "--branch"];
    else if (normalizedOperation === "diff") args = ["diff", "--stat", "--", ...normalizedPaths];
    else if (normalizedOperation === "log") args = ["log", "--oneline", "-n", "20"];
    else if (normalizedOperation === "branch") args = ["branch", "--list"];
    else if (normalizedOperation === "init") args = ["init"];
    else if (normalizedOperation === "add") args = ["add", "--", ...(normalizedPaths.length > 0 ? normalizedPaths : ["."])];
    else args = ["commit", "-m", String(message || "").trim().slice(0, 200)];
    if (normalizedOperation === "commit" && !args[2]) throw new Error("commit 必须提供非空 message。 ");

    const result = await spawnProcess("git", args, {
      cwd: resolved.target,
      timeoutMs: commandLimit,
      env: processEnv(),
    });
    return {
      ok: result.ok,
      operation: normalizedOperation,
      path: resolved.relative,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  async function runPython({ scope, code, filename = "main.py", args = [] } = {}) {
    if (mode === "disabled") {
      return { ok: false, error: "Python 沙箱当前未开启；请将 CODE_EXECUTION_MODE 配置为 docker 或 remote。" };
    }
    const source = typeof code === "string" ? code : String(code ?? "");
    if (!source.trim()) throw new Error("Python 代码不能为空。 ");
    if (Buffer.byteLength(source, "utf8") > fileLimit) throw new Error(`Python 代码超过 ${fileLimit} 字节上限。`);
    const filenameRelative = normalizeRelativePath(filename || "main.py");
    if (!/\.py$/iu.test(filenameRelative)) throw new Error("Python 文件名必须以 .py 结尾。 ");
    const normalizedArgs = Array.isArray(args)
      ? args.slice(0, 32).map((value) => String(value).slice(0, 200))
      : [];
    if (mode === "remote") {
      if (!sandboxRemoteUrl) {
        return { ok: false, error: "remote 沙箱未配置 SANDBOX_API_URL。" };
      }
      try {
        const response = await fetch(`${sandboxRemoteUrl}/run/python`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(sandboxRemoteToken ? { Authorization: `Bearer ${sandboxRemoteToken}` } : {}),
          },
          body: JSON.stringify({
            scope: `${safeScopePart(scope?.userId, "anonymous")}:${safeScopePart(scope?.chatId, "chat")}`,
            filename: filenameRelative,
            code: source,
            args: normalizedArgs,
          }),
          signal: AbortSignal.timeout(pythonLimit + 10_000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          return {
            ok: false,
            mode,
            isolation: "cloudflare-sandbox",
            error: payload?.error || `远程沙箱返回 HTTP ${response.status}。`,
          };
        }
        return {
          ...(payload && typeof payload === "object" ? payload : { result: payload }),
          mode,
          isolation: "cloudflare-sandbox",
          filename: filenameRelative,
        };
      } catch (error) {
        return { ok: false, mode, isolation: "cloudflare-sandbox", error: `远程沙箱不可用：${error.message}` };
      }
    }
    const workspace = await ensureWorkspace(scope);
    const file = await writeFile({ scope, relativePath: filenameRelative, content: source });
    let result;
    let isolation;
    if (mode === "docker") {
      const hostPath = workspace.root;
      const containerFile = `/workspace/${filenameRelative.replaceAll("\\", "/")}`;
      result = await spawnProcess("docker", [
        "run", "--rm",
        "--network", dockerNetworkMode === "nat" ? "bridge" : "none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=64",
        "--memory=512m",
        "--cpus=1",
        "--tmpfs=/tmp:rw,noexec,nosuid,size=64m",
        "-v", `${hostPath}:/workspace:rw`,
        "-w", "/workspace",
        dockerImage,
        "python", "-I", "-B", containerFile,
        ...normalizedArgs,
      ], {
        cwd: workspace.root,
        timeoutMs: pythonLimit,
        env: processEnv(),
      });
      isolation = `docker-network-${dockerNetworkMode}`;
    } else if (mode === "local") {
      result = await spawnProcess("python3", ["-I", "-B", filenameRelative, ...normalizedArgs], {
        cwd: workspace.root,
        timeoutMs: pythonLimit,
        env: processEnv({ PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" }),
      });
      isolation = "process-timeout-only";
    }
    return {
      ok: result.ok,
      filename: file.path,
      mode,
      isolation,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  async function describe(scope) {
    await ensureWorkspace(scope);
    return {
      root,
      scopeRoot: scopeRoot(scope),
      executionMode: mode,
      dockerNetworkMode: mode === "docker" ? dockerNetworkMode : null,
      networkAccess: mode === "docker"
        ? dockerNetworkMode === "nat" ? "nat" : "none"
        : mode === "remote" ? "internet" : mode === "local" ? "host-process" : "disabled",
      remoteConfigured: Boolean(sandboxRemoteUrl),
      maxFileBytes: fileLimit,
      maxTransferBytes: transferLimit,
      maxOutputBytes: outputLimit,
      pythonTimeoutMs: pythonLimit,
    };
  }

  return {
    root,
    executionMode: mode,
    ensureWorkspace,
    resolveSafe,
    readFile,
    readFileBuffer,
    writeFile,
    listFiles,
    makeDirectory,
    readAbsoluteFile,
    runGit,
    runPython,
    describe,
  };
}

module.exports = {
  createWorkspaceManager,
  normalizeRelativePath,
};
