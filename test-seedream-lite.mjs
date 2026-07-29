import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

const API_URL = "https://vvdance.yongmuai.com/api/v3/images/generations";
const MODEL = "dola-seedream-5-0-pro-260628";
const DEFAULT_PROMPT =
  "Generate a clean cinematic portrait, detailed and natural lighting, no text, no logo, no watermark.";

function printUsage() {
  console.log(`
Seedream 5.0 Lite image generation test

Usage:
  SEEDREAM_LITE_API_KEY=... node test-seedream-lite.mjs [options]

Options:
  --prompt <text>       Generation or edit prompt.
  --image <https-url>   Reference image URL; repeat up to 14 times.
  --size <value>        2K, 3K, 4K, or a valid widthxheight value. Default: 2K.
  --output <path>       Download result to this local path. Default: seedream-lite-result.png.
  --keep-watermark      Keep the API watermark. Default: false.
  --no-download         Only print the returned result URL.
  --help                Show this help.

Environment:
  SEEDREAM_LITE_API_KEY  Required. Sent as Authorization: Bearer <key>.

The documented endpoint uses Bearer authentication. SEEDREAM_LITE_API_SECRET
is intentionally not sent because the supplied API specification does not name
any HMAC signature header or signing algorithm.
`);
}

function getArguments(argv) {
  const options = {
    prompt: DEFAULT_PROMPT,
    images: [],
    size: "2K",
    output: "seedream-lite-result.png",
    watermark: false,
    download: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      printUsage();
      process.exit(0);
    }
    if (argument === "--keep-watermark") {
      options.watermark = true;
      continue;
    }
    if (argument === "--no-download") {
      options.download = false;
      continue;
    }
    if (!["--prompt", "--image", "--size", "--output"].includes(argument)) {
      throw new Error(`未知参数：${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} 需要一个值。`);
    }
    index += 1;

    if (argument === "--prompt") options.prompt = value;
    if (argument === "--image") options.images.push(value);
    if (argument === "--size") options.size = value;
    if (argument === "--output") options.output = value;
  }

  return options;
}

function validateOptions(options) {
  if (!options.prompt.trim() || options.prompt.length > 20_000) {
    throw new Error("提示词不能为空，且不能超过 20,000 个字符。");
  }
  if (options.images.length > 14) {
    throw new Error("Seedream 5.0 Lite 最多支持 14 张参考图。");
  }
  for (const imageUrl of options.images) {
    const url = new URL(imageUrl);
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new Error(`参考图必须使用 HTTP/HTTPS URL：${imageUrl}`);
    }
  }
}

function extensionForContentType(contentType) {
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/webp/i.test(contentType)) return "webp";
  return "png";
}

async function main() {
  const options = getArguments(process.argv.slice(2));
  validateOptions(options);

  const apiKey = process.env.SEEDREAM_LITE_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 SEEDREAM_LITE_API_KEY。请通过环境变量或 .env 设置，不要写入脚本。");
  }

  const body = {
    model: MODEL,
    prompt: options.prompt.trim(),
    size: options.size,
    response_format: "url",
    stream: false,
    sequential_image_generation: "disabled",
    output_format: "png",
    watermark: options.watermark,
    ...(options.images.length > 0 ? { image: options.images } : {}),
  };

  console.log(
    `请求 ${MODEL}：${options.images.length} 张参考图，${body.size}，${options.watermark ? "保留" : "关闭"}水印。`,
  );

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  const rawBody = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = String(payload?.error?.message || payload?.message || rawBody || "未知错误")
      .slice(0, 1_000);
    throw new Error(`Seedream 请求失败（HTTP ${response.status}）：${detail}`);
  }

  const result = payload?.data?.[0];
  const resultUrl = typeof result?.url === "string" ? result.url : "";
  if (!resultUrl) {
    throw new Error("接口未返回 data[0].url。请检查服务响应、模型权限和 response_format。");
  }

  console.log(`生成完成：${result.size || "未知尺寸"}`);
  console.log(`结果 URL（有效期通常为 24 小时）：${resultUrl}`);
  console.log(`用量：${JSON.stringify(payload.usage || {})}`);

  if (!options.download) return;

  const download = await fetch(resultUrl, { signal: AbortSignal.timeout(90_000) });
  if (!download.ok) {
    throw new Error(`结果图片下载失败（HTTP ${download.status}）。URL 仍已输出，可在有效期内手动下载。`);
  }
  const outputPath = path.resolve(process.cwd(), options.output);
  const output = Buffer.from(await download.arrayBuffer());
  await fs.writeFile(outputPath, output);
  const contentType = download.headers.get("content-type") || "";
  console.log(`已保存：${outputPath}（${output.length} bytes，${extensionForContentType(contentType)}）`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
