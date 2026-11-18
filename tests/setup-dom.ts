// Node 에서 DOMParser / btoa 사용을 위한 준비
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser ??= DOMParser;
(globalThis as any).btoa ??= (s: string) => Buffer.from(s, 'binary').toString('base64');
(globalThis as any).atob ??= (s: string) => Buffer.from(s, 'base64').toString('binary');
