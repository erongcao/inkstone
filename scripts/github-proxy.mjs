/**
 * 本地 CONNECT 代理：把 GitHub 的域名导向**可达的 anycast 边缘节点**。
 *
 * ## 为什么需要它
 *
 * 这台机器的 DNS 把 github.com 解析到 20.205.243.166（GitHub 香港段），
 * 那个 IP 的 443 端口连不通——TCP 握手超时，不是 TLS 问题、也不是鉴权问题。
 * 同网段其它站点（npmjs / baidu）都正常，所以是**到 GitHub 这条线路**的问题。
 *
 * GitHub 是 anycast：同一个域名有十几个边缘 IP，换一个就能通。
 * 但**web 与 API 的前端节点是不同的**：
 *
 * - `github.com`      → 140.82.112.3 / 140.82.114.3 / …（末位 3、4）
 * - `api.github.com`  → 140.82.112.5 / 140.82.114.5 / …（末位 5、6）
 *
 * 用错会怎样：把 api.github.com 指到 web 节点，对方会 **301 重定向到
 * `https://github.com/repos/…`**，于是所有 API 调用变成 404。
 *
 * ## 为什么不用第三方代理服务
 *
 * 走 gh-proxy 之类的公共代理，等于把 **GitHub token 交给第三方**。
 * 本地代理只做字节转发：TLS 仍然在本地和 GitHub 之间端到端终止，
 * 代理看不到请求头，也看不到 token。
 *
 * ## 用法
 *
 *   node scripts/github-proxy.mjs 8899 &
 *   git -c http.proxy=http://127.0.0.1:8899 push origin main
 *   HTTPS_PROXY=http://127.0.0.1:8899 gh run list
 */

import net from "node:net";
import http from "node:http";

const PORT = Number(process.argv[2] ?? 8899);

/** web 前端节点（末位 3 / 4） */
const WEB_IPS = [
  "140.82.112.3",
  "140.82.114.3",
  "140.82.116.3",
  "140.82.113.3",
  "20.200.245.247",
  "20.233.83.145",
  "20.27.177.113",
];

/** API 前端节点（末位 5 / 6） */
const API_IPS = [
  "140.82.112.5",
  "140.82.114.5",
  "140.82.116.5",
  "140.82.113.5",
  "140.82.112.6",
  "140.82.114.6",
];

/** 域名 → 可用节点组 */
const HOST_IPS = new Map([
  ["github.com", WEB_IPS],
  ["codeload.github.com", WEB_IPS],
  ["objects.githubusercontent.com", WEB_IPS],
  ["release-assets.githubusercontent.com", WEB_IPS],
  ["api.github.com", API_IPS],
]);

let index = 0;

function pickIp(pool) {
  const ip = pool[index % pool.length];
  index += 1;
  return ip;
}

const server = http.createServer((req, res) => {
  // 只支持 CONNECT（https 走代理的标准形态）
  res.writeHead(501, { "content-type": "text/plain" });
  res.end("only CONNECT is supported\n");
});

server.on("connect", (req, clientSocket, head) => {
  const [host, portRaw] = req.url.split(":");
  const port = Number(portRaw || 443);

  const pool = HOST_IPS.get(host);
  const useIp = pool ? pickIp(pool) : null;

  const upstream = net.connect({ host: useIp ?? host, port }, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const fail = (err) => {
    console.error(`[proxy] ${host}:${port} -> ${useIp ?? host} 失败：${err.message}`);
    clientSocket.end();
    upstream.destroy();
  };

  upstream.on("error", fail);
  clientSocket.on("error", fail);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[proxy] 监听 127.0.0.1:${PORT}`);
  console.log(`[proxy] github.com → ${WEB_IPS.join(", ")}`);
  console.log(`[proxy] api.github.com → ${API_IPS.join(", ")}`);
});
