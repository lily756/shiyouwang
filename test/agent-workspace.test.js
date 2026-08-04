const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createWorkspaceManager, normalizeRelativePath } = require("../lib/agent-workspace");

test("workspace paths are scoped and reject traversal", () => {
  assert.equal(normalizeRelativePath("src\\main.py"), "src/main.py");
  assert.throws(() => normalizeRelativePath("../outside"), /不能离开/);
  assert.throws(() => normalizeRelativePath("/etc/passwd"), /相对路径/);
});

test("workspace file operations stay inside a per-chat root", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-workspace-test-"));
  try {
    const manager = createWorkspaceManager({ rootDir: root, executionMode: "disabled" });
    const scope = { userId: "u/1", chatId: "c/2" };
    await manager.writeFile({ scope, relativePath: "src/main.py", content: "print('ok')\n" });
    const loaded = await manager.readFile({ scope, relativePath: "src/main.py" });
    assert.equal(loaded.content, "print('ok')\n");
    const binary = await manager.readFileBuffer({ scope, relativePath: "src/main.py" });
    assert.equal(Buffer.isBuffer(binary.content), true);
    assert.equal(binary.content.toString("utf8"), "print('ok')\n");
    assert.equal((await manager.listFiles({ scope, relativePath: "src" }))[0].path, "src/main.py");
    await assert.rejects(manager.resolveSafe(scope, "../../outside"), /不能离开/);
    assert.match((await manager.describe(scope)).scopeRoot, /u_1[\\/]c_2$/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("docker network mode is explicit and reports NAT isolation", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-network-test-"));
  try {
    const manager = createWorkspaceManager({ rootDir: root, executionMode: "docker", networkMode: "nat" });
    const info = await manager.describe({ userId: "u", chatId: "c" });
    assert.equal(info.dockerNetworkMode, "nat");
    assert.equal(info.networkAccess, "nat");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("disabled python mode fails closed", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-python-test-"));
  try {
    const manager = createWorkspaceManager({ rootDir: root, executionMode: "disabled" });
    const result = await manager.runPython({ scope: { userId: "u", chatId: "c" }, code: "print(1)" });
    assert.equal(result.ok, false);
    assert.match(result.error, /未开启/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("remote python mode sends code only to the configured sandbox endpoint", async () => {
  const originalFetch = global.fetch;
  let receivedRequest = null;
  global.fetch = async (url, options) => {
    receivedRequest = { url, options };
    const body = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, isolation: "cloudflare-sandbox", filename: body.filename }),
    };
  };
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-remote-test-"));
  try {
    const manager = createWorkspaceManager({
      rootDir: root,
      executionMode: "remote",
      remoteUrl: "https://sandbox.example.test",
      remoteToken: "test-token",
    });
    const result = await manager.runPython({ scope: { userId: "u", chatId: "c" }, code: "print(1)" });
    assert.equal(result.ok, true);
    assert.equal(result.isolation, "cloudflare-sandbox");
    assert.equal(result.filename, "main.py");
    assert.equal(receivedRequest.url, "https://sandbox.example.test/run/python");
    assert.equal(receivedRequest.options.headers.Authorization, "Bearer test-token");
  } finally {
    global.fetch = originalFetch;
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("remote workspace binary reads use a bounded base64 transfer", async () => {
  const originalFetch = global.fetch;
  let receivedRequest = null;
  global.fetch = async (url, options) => {
    receivedRequest = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        path: "/workspace/out.bin",
        encoding: "base64",
        content: Buffer.from("hello").toString("base64"),
        mimeType: "application/octet-stream",
      }),
    };
  };
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-remote-file-test-"));
  try {
    const manager = createWorkspaceManager({
      rootDir: root,
      executionMode: "remote",
      remoteUrl: "https://sandbox.example.test",
      remoteToken: "test-token",
    });
    const result = await manager.readFileBuffer({ scope: { userId: "u", chatId: "c" }, relativePath: "out.bin" });
    assert.equal(result.content.toString("utf8"), "hello");
    assert.equal(result.bytes, 5);
    assert.equal(receivedRequest.url, "https://sandbox.example.test/workspace/files");
    const body = JSON.parse(receivedRequest.options.body);
    assert.equal(body.operation, "read_binary");
    assert.equal(body.path, "out.bin");
    assert.equal(receivedRequest.options.headers.Authorization, "Bearer test-token");
  } finally {
    global.fetch = originalFetch;
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("git operations are limited to an initialized workspace repository", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-git-test-"));
  try {
    const manager = createWorkspaceManager({ rootDir: root, executionMode: "disabled" });
    const scope = { userId: "u", chatId: "c" };
    const initialized = await manager.runGit({ scope, operation: "init", confirm: true });
    assert.equal(initialized.ok, true);
    const status = await manager.runGit({ scope, operation: "status" });
    assert.equal(status.ok, true);
    await assert.rejects(manager.runGit({ scope, operation: "push" }), /只允许/);
    await assert.rejects(manager.runGit({ scope, operation: "commit", message: "no confirm" }), /confirm=true/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
