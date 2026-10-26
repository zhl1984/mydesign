/** 原业务地址与PRD页面的最小绑定契约。 */
export interface PagePrdPath {
  id: string;
  path: string;
  aliases?: string[];
}
/** 仅查找文档绑定，不注册路由或校验业务对象是否存在。 */
export function findPage<T extends PagePrdPath>(
  pages: T[],
  path: string,
): T | null;
