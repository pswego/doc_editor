/** "1-3, 5, 8-" → [[0,1,2],[4],[7..n-1]] */
export function parseRanges(spec: string, n: number): number[][] {
  const groups: number[][] = [];
  for (const part of spec.split(/[,，\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*[-~]\s*(\d*)$/.exec(part);
    let a: number, b: number;
    if (m) {
      a = m[1] ? Number(m[1]) : 1;
      b = m[2] ? Number(m[2]) : n;
    } else if (/^\d+$/.test(part)) a = b = Number(part);
    else throw new Error(`‘${part}’은(는) 올바른 쪽 범위가 아닙니다.`);
    if (a < 1 || b > n || a > b) throw new Error(`‘${part}’ 범위가 문서 쪽 수(1~${n})를 벗어납니다.`);
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  return groups;
}

