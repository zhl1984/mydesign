import type { Server } from "node:http";
/** 可交由Vite内部中间件驱动的本地文件处理器；调用方无需启动端口。 */
export function createReviewServer(
  directory?: string,
  ids?: string[],
  assetsDirectory?: string,
): Server;
