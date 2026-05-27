const https = require("https");
const http  = require("http");
const fs    = require("fs");

const OUTPUT = "ips.txt";

const SOURCES = [
  "https://raw.githubusercontent.com/monosans/proxy-list/refs/heads/main/proxies/all.txt",
  "https://raw.githubusercontent.com/LoneKingCode/free-proxy-db/refs/heads/main/proxies/all.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/refs/heads/main/all.txt",
  "https://raw.githubusercontent.com/iplocate/free-proxy-list/refs/heads/main/all-proxies.txt",
  "https://raw.githubusercontent.com/MohammadBahemmat/V2ray-Collector/refs/heads/main/servers/socks5_servers.txt",
  "https://raw.githubusercontent.com/MohammadBahemmat/V2ray-Collector/refs/heads/main/servers/socks_servers.txt",
  "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/All_proxies.txt",
];

function fetch(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    let data = "";
    const req = lib.get(url, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve);
      }
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve(data));
    });
    req.on("timeout", () => { req.destroy(); resolve(""); });
    req.on("error",   () => resolve(""));
  });
}

// Regex: cocokkan socks5://ip:port, http://ip:port, atau plain ip:port
const PROXY_RE = /^(?:(socks5|socks4|https?):\/\/)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/;

function extractProxies(text) {
  const found = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(PROXY_RE);
    if (!m) continue;
    const port = parseInt(m[3]);
    if (port < 1 || port > 65535) continue;
    // Simpan as-is kalau ada prefix, kalau tidak plain ip:port
    const prefix = m[1] ? m[1] + "://" : "";
    found.push(`${prefix}${m[2]}:${m[3]}`);
  }
  return found;
}

async function main() {
  console.log(`Fetching ${SOURCES.length} sources...\n`);

  const seen = new Set();
  const all  = [];
  let done   = 0;

  await Promise.all(SOURCES.map(async (url) => {
    const text    = await fetch(url);
    const proxies = extractProxies(text);
    let added = 0;
    for (const p of proxies) {
      if (!seen.has(p)) { seen.add(p); all.push(p); added++; }
    }
    done++;
    console.log(`[${done}/${SOURCES.length}] ${proxies.length} found, ${added} new — ${url.split("/").slice(-1)[0]}`);
  }));

  fs.writeFileSync(OUTPUT, all.join("\n"));
  console.log(`\n✅ Total: ${all.length} proxy unik disimpan ke ${OUTPUT}`);
}

main().catch(console.error);
