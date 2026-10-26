import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 只安装技能；先备份旧版，保留客户端已配置的符号链接。 */
async function install() {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--target", "--backup-dir"].includes(args[i]) || !args[i + 1])
      throw new Error(
        "用法: node install.mjs --target <技能目录/page-prd> [--backup-dir <备份目录>]",
      );
    options.set(args[i], args[i + 1]);
  }
  if (!options.has("--target"))
    throw new Error("必须明确 --target，安装器不会自行选择客户端目录");
  const source = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const configured = resolve(
    options.get("--target").replace(/^~(?=[/\\]|$)/, homedir()),
  );
  if (basename(configured) !== "page-prd")
    throw new Error("目标文件夹必须命名为 page-prd");
  let target = configured,
    exists = false;
  try {
    const entry = await lstat(configured);
    if (!entry.isDirectory() && !entry.isSymbolicLink())
      throw new Error("目标不是技能文件夹");
    target = await realpath(configured);
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const rel = relative(source, target);
  const reverse = relative(target, source);
  if (
    rel === "" ||
    (!rel.startsWith(".." + sep) && rel !== "..") ||
    (!reverse.startsWith(".." + sep) && reverse !== "..")
  )
    throw new Error("安装来源与目标不能相同或相互嵌套");
  if (exists) await readFile(join(target, "SKILL.md"), "utf8");
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".page-prd-install-"));
  let backup = null;
  try {
    await cp(source, join(staging, "page-prd"), { recursive: true });
    if (exists) {
      const backupRoot = resolve(
        options.get("--backup-dir") || join(homedir(), ".page-prd-backups"),
      );
      const nesting = relative(target, backupRoot);
      if (
        nesting === "" ||
        (!nesting.startsWith(".." + sep) && nesting !== "..")
      )
        throw new Error("备份目录不能放在被替换技能内部");
      await mkdir(backupRoot, { recursive: true });
      const version = await mkdtemp(join(backupRoot, "page-prd-"));
      backup = join(version, "page-prd");
      // Back up by copy because a shared target may live on another filesystem.
      await cp(target, backup, { recursive: true });
    }
    const previous = join(staging, "previous");
    if (exists) await rename(target, previous);
    try {
      await rename(join(staging, "page-prd"), target);
    } catch (error) {
      if (exists) await rename(previous, target);
      throw error;
    }
    console.log(
      JSON.stringify({ installed: configured, resolved: target, backup }),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

install().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
