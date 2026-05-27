const fs = require("fs");
const net = require("net");
const { SocksClient } = require("socks");
const http = require("http");
const https = require("https");

const INPUT_FILE = "data.txt";
const OUTPUT_FILE = "ips.txt";
const TEST_URL = "http://httpbin.org/ip";
const TIMEOUT = 5000;
const CONCURRENCY = 50;

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseProxy(line) {
  line = line.trim();
  if (!line || line.startsWith("#")) return null;

  let type = "http";
  let raw = line;

  if (/^socks5:\/\//i.test(line)) {
    type = "socks5";
    raw = line.replace(/^socks5:\/\//i, "");
  } else if (/^socks4:\/\//i.test(line)) {
    type = "socks4";
    raw = line.replace(/^socks4:\/\//i, "");
  } else if (/^https?:\/\//i.test(line)) {
    type = /^https/i.test(line) ? "https" : "http";
    raw = line.replace(/^https?:\/\//i, "");
  }

  // strip trailing path
  raw = raw.split("/")[0];

  // user:pass@host:port  or  host:port
  let auth = null;
  if (raw.includes("@")) {
    const [credentials, hostpart] = raw.split("@");
    auth = credentials;
    raw = hostpart;
  }

  const lastColon = raw.lastIndexOf(":");
  if (lastColon === -1) return null;

  const host = raw.slice(0, lastColon);
  const port = parseInt(raw.slice(lastColon + 1), 10);
  if (!host || isNaN(port) || port < 1 || port > 65535) return null;

  return { type, host, port, auth };
}

// ─── Checkers ─────────────────────────────────────────────────────────────────

function checkHttpProxy(proxy) {
  return new Promise((resolve) => {
    const start = Date.now();
    const url = new URL(TEST_URL);
    const lib = url.protocol === "https:" ? https : http;

    const options = {
      host: proxy.host,
      port: proxy.port,
      path: TEST_URL,
      method: "GET",
      timeout: TIMEOUT,
      headers: { Host: url.hostname },
    };

    if (proxy.auth) {
      options.headers["Proxy-Authorization"] =
        "Basic " + Buffer.from(proxy.auth).toString("base64");
    }

    const req = lib.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", () => {
        resolve({ ok: res.statusCode < 500, ms: Date.now() - start });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, ms: TIMEOUT });
    });
    req.on("error", () => resolve({ ok: false, ms: TIMEOUT }));
    req.end();
  });
}

function checkSocksProxy(proxy) {
  return new Promise((resolve) => {
    const start = Date.now();
    const url = new URL(TEST_URL);
    const destPort = url.protocol === "https:" ? 443 : 80;

    const options = {
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: proxy.type === "socks5" ? 5 : 4,
      },
      destination: { host: url.hostname, port: destPort },
      command: "connect",
      timeout: TIMEOUT,
    };

    SocksClient.createConnection(options)
      .then((info) => {
        info.socket.destroy();
        resolve({ ok: true, ms: Date.now() - start });
      })
      .catch(() => resolve({ ok: false, ms: TIMEOUT }));
  });
}

async function checkProxy(proxy) {
  if (proxy.type === "socks5" || proxy.type === "socks4") {
    return checkSocksProxy(proxy);
  }
  return checkHttpProxy(proxy);
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────

async function runConcurrent(tasks, limit) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Check socks dependency
  try {
    require.resolve("socks");
  } catch {
    console.error(
      'Package "socks" tidak ditemukan. Jalankan:\n  npm install socks',
    );
    process.exit(1);
  }

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`File "${INPUT_FILE}" tidak ditemukan.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(INPUT_FILE, "utf8").split("\n");
  const proxies = lines.map(parseProxy).filter(Boolean);

  console.log(`Total proxy ditemukan : ${proxies.length}`);
  console.log(`Concurrency           : ${CONCURRENCY}`);
  console.log(`Timeout               : ${TIMEOUT}ms\n`);

  let done = 0;
  const valid = [];

  const tasks = proxies.map((proxy) => async () => {
    const result = await checkProxy(proxy);
    done++;

    const label = `${proxy.host}:${proxy.port}`;
    if (result.ok) {
      valid.push({ proxy, ms: result.ms });
      process.stdout.write(
        `\r[${done}/${proxies.length}] ✓ ${label} (${result.ms}ms)          \n`,
      );
    } else {
      process.stdout.write(`\r[${done}/${proxies.length}] checking...`);
    }
  });

  await runConcurrent(tasks, CONCURRENCY);

  // Sort by response time
  valid.sort((a, b) => a.ms - b.ms);

  const output = valid.map((v) => `${v.proxy.host}:${v.proxy.port}`).join("\n");
  fs.writeFileSync(OUTPUT_FILE, output);

  console.log(`\n\n✅ Selesai!`);
  console.log(`   Valid   : ${valid.length} proxy`);
  console.log(`   Invalid : ${proxies.length - valid.length} proxy`);
  console.log(
    `   Disimpan ke "${OUTPUT_FILE}" (diurutkan tercepat → terlambat)`,
  );

  if (valid.length > 0) {
    console.log(`\nTop 5 tercepat:`);
    valid.slice(0, 5).forEach((v, i) => {
      console.log(
        `  ${i + 1}. ${v.proxy.host}:${v.proxy.port}  [${v.proxy.type}]  ${v.ms}ms`,
      );
    });
  }
}

main().catch(console.error);
