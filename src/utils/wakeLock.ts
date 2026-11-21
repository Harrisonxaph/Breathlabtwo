interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

let activeSentinel: WakeLockSentinelLike | null = null;

export function isWakeLockSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'wakeLock' in navigator && Boolean((navigator as NavigatorWithWakeLock).wakeLock);
}

export async function acquireWakeLock(): Promise<boolean> {
  if (!isWakeLockSupported()) return false;
  if (activeSentinel && !activeSentinel.released) return true;

  try {
    const wl = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wl) return false;
    const sentinel = await wl.request('screen');
    activeSentinel = sentinel;
    sentinel.addEventListener?.('release', () => {
      if (activeSentinel === sentinel) {
        activeSentinel = null;
      }
    });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (!activeSentinel) return;
  const current = activeSentinel;
  activeSentinel = null;
  try {
    await current.release();
  } catch {
    // Ignore already-released sentinel
  }
}
