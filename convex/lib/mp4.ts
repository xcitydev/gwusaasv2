/**
 * Duration of an MP4/MOV from its `mvhd` atom, read with Range requests so
 * a 50 MB upload never gets pulled into an action. The `moov` box sits at
 * the head of fast-start files and at the tail of phone recordings — both
 * are checked. Returns null when the file isn't ISO-BMFF (e.g. WebM) or the
 * box lives somewhere else; callers fall back to the client's measurement.
 */

const WINDOW_BYTES = 2 * 1024 * 1024;

export async function probeMp4DurationSec(url: string): Promise<number | null> {
  try {
    const head = await fetch(url, { headers: { Range: `bytes=0-${WINDOW_BYTES - 1}` } });
    if (!head.ok) return null;
    const headBytes = new Uint8Array(await head.arrayBuffer());
    const found = findMvhdDuration(headBytes);
    if (found !== null) return found;
    // The server ignored Range and sent the whole file — nothing more to read.
    if (head.status === 200) return null;
    // Tail window as an EXPLICIT range: Convex storage (and some CDNs) 500 on
    // suffix ranges like "bytes=-N", so the length comes from Content-Range.
    const total = Number(head.headers.get("content-range")?.split("/")[1]);
    if (!Number.isFinite(total) || total <= headBytes.length) return null;
    const start = Math.max(headBytes.length, total - WINDOW_BYTES);
    const tail = await fetch(url, { headers: { Range: `bytes=${start}-${total - 1}` } });
    if (!tail.ok) return null;
    return findMvhdDuration(new Uint8Array(await tail.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Scan a byte window for an `mvhd` box and return its duration in seconds. */
export function findMvhdDuration(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 4 <= bytes.length; i++) {
    // "mvhd"
    if (
      bytes[i] !== 0x6d ||
      bytes[i + 1] !== 0x76 ||
      bytes[i + 2] !== 0x68 ||
      bytes[i + 3] !== 0x64
    ) {
      continue;
    }
    const body = i + 4; // version(1) flags(3) follow the type
    if (body + 4 > bytes.length) continue;
    const version = bytes[body];
    if (version === 0) {
      // creation(4) modification(4) timescale(4) duration(4)
      if (body + 20 > bytes.length) continue;
      const timescale = view.getUint32(body + 12);
      const duration = view.getUint32(body + 16);
      if (timescale > 0 && duration > 0) return duration / timescale;
    } else if (version === 1) {
      // creation(8) modification(8) timescale(4) duration(8)
      if (body + 32 > bytes.length) continue;
      const timescale = view.getUint32(body + 20);
      const duration = Number(view.getBigUint64(body + 24));
      if (timescale > 0 && duration > 0) return duration / timescale;
    }
  }
  return null;
}
