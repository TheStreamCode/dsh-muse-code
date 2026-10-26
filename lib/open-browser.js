// Best-effort "open this URL in the user's default browser" for the host side.
//
// DeepSeek Harness has no provider-neutral host service for opening an external
// page; its account flow delegates that to the Desktop shell. The sign-in needs
// the Meta verification page in a browser, so this module hands the URL to the
// platform's own URI handler without a shell: `rundll32 url.dll,FileProtocolHandler`
// on Windows, `open` on macOS, `xdg-open` elsewhere.
//
// Failure is never fatal: the command and the login route both return the URL
// as text so the user can open it manually.
import { spawn } from "node:child_process";
/**
 * Hand one http(s) URL to the platform's default browser.
 * @param url - absolute URL to open.
 * @param spawnImpl - injectable process spawner, for tests.
 * @returns whether the hand-off was started; it does not prove a page opened.
 */
export function openExternal(url, spawnImpl = spawn) {
    if (!/^https?:\/\//i.test(url))
        return false;
    const [command, args] = openerCommand(url);
    try {
        const child = spawnImpl(command, args, { detached: true, stdio: "ignore", windowsHide: true });
        child.on("error", () => { });
        child.unref();
        return true;
    }
    catch {
        return false;
    }
}
function openerCommand(url) {
    if (process.platform === "win32")
        return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
    if (process.platform === "darwin")
        return ["open", [url]];
    return ["xdg-open", [url]];
}
