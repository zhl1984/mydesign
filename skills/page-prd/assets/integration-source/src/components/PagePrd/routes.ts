import { findPage } from "../../../designs/prd-review-v1/state.mjs";
import manifest from "../../../designs/prd-review-v1/manifest.json";

/** 已登记页面共享一份绑定配置，PRD不得反向注册或修改业务路由。 */
export function hasPagePrd(path: string): boolean {
  return findPage(manifest.pages, path) !== null;
}
