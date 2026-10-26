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

/**
 * 每个域名的连接状态。
 *
 * ## 为什么要记「健康度」
 *
 * 边缘节点是**时好时坏**的：实测同一批 IP 里，有的秒连、有的直接超时
 * （2026-10-26 探针结果：7 个 web 节点里 2 个 15 秒超时）。
 *
 * 而 push 是个**持续传输**：连接建起来了不代表传得完——
 * 中途被对端 RST 就会得到
 * 「Error in the HTTP2 framing layer」或「Empty reply from server」。
 * 一轮 CI 的推送要传整个 pack，撞上坏节点就是白等几分钟。
 *
 * 所以这里做两件事：
 *
 * 1. **连接失败就换下一个节点重试**（最多试遍整组）
 * 2. **记住刚才哪个节点是通的**，下一次优先用它
 * 3. **失败的节点拉黑一段时间**，别再轮询到它
 */
const hostState = new Map();

/** 拉黑时长：5 分钟。够短，节点恢复后能重新进池；够长，避开反复踩坑 */
const BLACKLIST_MS = 5 * 60 * 1000;

/** 取一个域名当前可用的节点（按「上次好用的优先」排序） */
function candidates(host, pool) {
  const state = hostState.get(host) ?? { lastGood: null, blacklist: new Map() };
  hostState.set(host, state);

  const now = Date.now();
  // 过期了就从黑名单里放出来
  for (const [ip, until] of state.blacklist) {
    if (until <= now) state.blacklist.delete(ip);
  }

  const usable = pool.filter((ip) => !state.blacklist.has(ip));
  // 全被拉黑了：宁可去踩雷，也得有节点可用
  const list = usable.length > 0 ? usable : pool;

  // 上次好用的排最前，其余保持原有顺序
  if (state.lastGood) {
    const i = list.indexOf(state.lastGood);
    if (i > 0) list.unshift(...list.splice(i, 1));
  }
  return list;
}

/** 记下这个节点是通的 */
function markGood(host, ip) {
  const state = hostState.get(host);
  if (!state) return;
  state.lastGood = ip;
  state.blacklist.delete(ip);
}

/** 记下这个节点是坏的，短期内不再用 */
function markBad(host, ip, reason) {
  const state = hostState.get(host);
  if (!state) return;
  state.blacklist.set(ip, Date.now() + BLACKLIST_MS);
  if (state.lastGood === ip) state.lastGood = null;
  console.error(`[proxy] ${host} -> ${ip} 失败：${reason}（拉黑 5 分钟）`);
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
  const list = pool ? candidates(host, pool) : [host];
  let attempt = 0;

  /**
   * 连下一个节点。
   *
   * 连接**建立之前**的错误（超时 / RST）可以干净地换节点重试；
   * 一旦把 200 Connection Established 发给客户端，就只能断开——
   * 这时候再换节点也没用了，客户端那边的会话已经废了。
   */
  function connectNext() {
    if (attempt >= list.length) {
      clientSocket.end("proxy: no usable upstream\n");
      return;
    }
    const ip = list[attempt];
    attempt += 1;

    const upstream = net.connect({ host: ip, port });
    let established = false;

    upstream.once("connect", () => {
      established = true;
      markGood(host, ip);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.once("error", (err) => {
      if (established) {
        // 传输中途断了：只能断开，客户端会自己重试
        clientSocket.destroy();
        markBad(host, ip, err.message);
        return;
      }
      // 还没建连：换下一个节点
      markBad(host, ip, err.message);
      upstream.destroy();
      connectNext();
    });

    clientSocket.once("error", () => {
      upstream.destroy();
    });
  }

  connectNext();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[proxy] 监听 127.0.0.1:${PORT}`);
  console.log(`[proxy] github.com → ${WEB_IPS.join(", ")}`);
  console.log(`[proxy] api.github.com → ${API_IPS.join(", ")}`);
});
