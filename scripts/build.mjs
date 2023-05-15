import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import os from "node:os";
import { exec } from "node:child_process";
const aexec = promisify(exec);
import { promisify } from "node:util";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const { platform } = process;

const root = path.resolve(__dirname, "../");
const buildDir = path.resolve(root, "build");
const outDir = path.resolve(root, "out");

function log(step, status) {
    console.log(`[${step}] ${new Date().toISOString()} ${status}`);
}

async function downloadPkg(location, repo, commit, force = false) {
    if (!force) {
        const stat = await fs.promises.stat(location).catch(() => { });
        if (stat) return;
    }
    await fs.promises.rm(location, { recursive: true }).catch(() => { });
    await fs.promises.mkdir(location, { recursive: true });
    const flags = commit == "HEAD" ? [] : [`git fetch --depth=1 origin ${commit}`, `git checkout ${commit}`];
    await aexec([
        `git clone --depth=1 ${repo} ${location}`,
        `cd ${location}`,
        ...flags
    ].join(" && "), {
        cwd: root,
        env: {
            ...process.env,
        }
    });
}

// Download dawn and depot_tools
log("Dawn", "cloning");
await downloadPkg(path.join(buildDir, "dawn"), "https://dawn.googlesource.com/dawn", "906fc9df206d668191e9660a16688e27eb3d97ce", false);
log("Dawn", "cloned");
log("Depot Tools", "cloning");
await downloadPkg(path.join(buildDir, "depot_tools"), "https://chromium.googlesource.com/chromium/tools/depot_tools.git", "HEAD", false);
log("Depot Tools", "cloned");

// Install dependencies
await fs.promises.copyFile(path.join(buildDir, "dawn", "scripts", "standalone-with-node.gclient"), path.join(buildDir, "dawn", ".gclient"));

log("Dawn", "installing dependencies");
const sep = platform == "win32" ? `;` : ":";
await aexec(`gclient sync --no-history -j${os.cpus().length} -vvv`,
    {
        cwd: path.join(buildDir, "dawn"),
        env: {
            ...process.env,
            PATH: `${path.join(buildDir, "depot_tools")}${sep}${process.env.PATH}`,
            DEPOT_TOOLS_UPDATE: '0',
            DEPOT_TOOLS_WIN_TOOLCHAIN: '0',
        }
    });
log("Dawn", "installed dependencies");

let cflags = "";
let ldflags = "";
const flags = [
    `-S ${path.join(buildDir, "dawn")}`,
    `-B ${path.join(outDir, "dawn")}`,
    '-GNinja',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DDAWN_ENABLE_PIC=1',
    '-DDAWN_BUILD_NODE_BINDINGS=1',
    '-DTINT_BUILD_SAMPLES=0',
    '-DTINT_BUILD_TESTS=0',
    '-DDAWN_BUILD_SAMPLES=0'
];

log("Dawn", "building");
await aexec(`cmake ${flags.join(' ')}`, {
    cwd: root,
    env: {
        ...process.env,
        cflags,
        ldflags,
    }
})
log("Dawn", "built");

log("Dawn", "running ninja");
try {
    const { stdout } = await aexec(`ninja -C ${path.join(outDir, "dawn")} -j${os.cpus().length} dawn.node`, {
        cwd: root,
        env: {
            ...process.env,
            DEPOT_TOOLS_WIN_TOOLCHAIN: '0'
        }
    });
    log("Dawn", "finished ninja");
} catch (e) {
    console.error("[Dawn] error: ", e);
    process.exit(1);
}
await fs.promises.copyFile(path.join(outDir, "dawn", "dawn.node"), path.join(root, "dawn.node"));