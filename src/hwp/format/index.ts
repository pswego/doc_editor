import { readHwp5 } from './hwp5';
import { readHwpx } from './hwpx-read';
import type { HwpDocument } from './types';

export { writeHwpx } from './hwpx-write';
export * from './types';

/** HWP(5.0 바이너리) 또는 HWPX 바이트 → 편집 문서 */
export async function readHangul(bytes: Uint8Array): Promise<HwpDocument> {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return readHwp5(bytes);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readHwpx(bytes);
  const head = new TextDecoder().decode(bytes.subarray(0, 32));
  if (head.startsWith('HWP Document File V3')) throw new Error('HWP 3.0 이하 형식은 지원하지 않습니다. 한글에서 HWP 5.0/HWPX로 저장한 뒤 열어 주세요.');
  throw new Error('한글 문서(HWP/HWPX) 형식이 아닙니다.');
}
