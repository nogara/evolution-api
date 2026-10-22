export function resolvePhoneRemoteJid(key: { remoteJid?: string; remoteJidAlt?: string }): string | undefined {
  if (key.remoteJid?.includes('@lid') && key.remoteJidAlt) {
    return key.remoteJidAlt;
  }

  return key.remoteJid;
}
