import { spawn } from "node:child_process";
type SpawnLike = typeof spawn;
/**
 * Hand one http(s) URL to the platform's default browser.
 * @param url - absolute URL to open.
 * @param spawnImpl - injectable process spawner, for tests.
 * @returns whether the hand-off was started; it does not prove a page opened.
 */
export declare function openExternal(url: string, spawnImpl?: SpawnLike): boolean;
export {};
