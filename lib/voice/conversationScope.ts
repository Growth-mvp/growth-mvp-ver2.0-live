/* 音声会話を画面切替で続けてよい経路（同じ会社内のSTAGE1〜4）。それ以外へ移るときは会話を止める */
const VOICE_STAGE_PATHS = ['/stage1', '/stage2', '/stage3', '/cascade', '/stage4', '/okr'];

export function isVoiceStagePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return VOICE_STAGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function keepsVoiceOnPathChange(from: string | null | undefined, to: string | null | undefined): boolean {
  return isVoiceStagePath(from) && isVoiceStagePath(to);
}
