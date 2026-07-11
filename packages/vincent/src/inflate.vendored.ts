/**
 * tiny-inflate v1.0.3
 * https://github.com/devongovett/tiny-inflate
 *
 * MIT License
 *
 * Copyright (c) 2015-present Devon Govett
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const TINF_OK = 0;
const TINF_DATA_ERROR = -3;

class Tree {
  table = new Uint16Array(16);
  trans = new Uint16Array(288);
}

class Data {
  sourceIndex = 0;
  tag = 0;
  bitcount = 0;
  destLen = 0;
  ltree = new Tree();
  dtree = new Tree();

  constructor(
    readonly source: Uint8Array,
    readonly dest: Uint8Array,
  ) {}
}

const sltree = new Tree();
const sdtree = new Tree();
const lengthBits = new Uint8Array(30);
const lengthBase = new Uint16Array(30);
const distBits = new Uint8Array(30);
const distBase = new Uint16Array(30);
const clcidx = new Uint8Array([
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
]);
const codeTree = new Tree();
const lengths = new Uint8Array(288 + 32);
const offs = new Uint16Array(16);

function tinfBuildBitsBase(bits: Uint8Array, base: Uint16Array, delta: number, first: number): void {
  for (let i = 0; i < delta; i += 1) bits[i] = 0;
  for (let i = 0; i < 30 - delta; i += 1) bits[i + delta] = (i / delta) | 0;

  let sum = first;
  for (let i = 0; i < 30; i += 1) {
    base[i] = sum;
    sum += 1 << bits[i];
  }
}

function tinfBuildFixedTrees(lt: Tree, dt: Tree): void {
  for (let i = 0; i < 7; i += 1) lt.table[i] = 0;
  lt.table[7] = 24;
  lt.table[8] = 152;
  lt.table[9] = 112;

  for (let i = 0; i < 24; i += 1) lt.trans[i] = 256 + i;
  for (let i = 0; i < 144; i += 1) lt.trans[24 + i] = i;
  for (let i = 0; i < 8; i += 1) lt.trans[24 + 144 + i] = 280 + i;
  for (let i = 0; i < 112; i += 1) lt.trans[24 + 144 + 8 + i] = 144 + i;

  for (let i = 0; i < 5; i += 1) dt.table[i] = 0;
  dt.table[5] = 32;
  for (let i = 0; i < 32; i += 1) dt.trans[i] = i;
}

function tinfBuildTree(t: Tree, codeLengths: Uint8Array, off: number, num: number): void {
  for (let i = 0; i < 16; i += 1) t.table[i] = 0;
  for (let i = 0; i < num; i += 1) {
    const len = codeLengths[off + i] ?? 0;
    t.table[len] += 1;
  }

  t.table[0] = 0;

  let sum = 0;
  for (let i = 0; i < 16; i += 1) {
    offs[i] = sum;
    sum += t.table[i] ?? 0;
  }

  for (let i = 0; i < num; i += 1) {
    const len = codeLengths[off + i] ?? 0;
    if (len) {
      t.trans[offs[len]] = i;
      offs[len] += 1;
    }
  }
}

function tinfGetbit(d: Data): number {
  if (!d.bitcount) {
    d.tag = d.source[d.sourceIndex] ?? 0;
    d.sourceIndex += 1;
    d.bitcount = 7;
  } else {
    d.bitcount -= 1;
  }

  const bit = d.tag & 1;
  d.tag >>>= 1;
  return bit;
}

function tinfReadBits(d: Data, num: number, base: number): number {
  if (!num) {
    return base;
  }

  while (d.bitcount < 24) {
    d.tag |= (d.source[d.sourceIndex] ?? 0) << d.bitcount;
    d.sourceIndex += 1;
    d.bitcount += 8;
  }

  const val = d.tag & (0xffff >>> (16 - num));
  d.tag >>>= num;
  d.bitcount -= num;
  return val + base;
}

function tinfDecodeSymbol(d: Data, t: Tree): number {
  while (d.bitcount < 24) {
    d.tag |= (d.source[d.sourceIndex] ?? 0) << d.bitcount;
    d.sourceIndex += 1;
    d.bitcount += 8;
  }

  let sum = 0;
  let cur = 0;
  let len = 0;
  let tag = d.tag;

  do {
    cur = 2 * cur + (tag & 1);
    tag >>>= 1;
    len += 1;
    sum += t.table[len] ?? 0;
    cur -= t.table[len] ?? 0;
  } while (cur >= 0);

  d.tag = tag;
  d.bitcount -= len;
  return t.trans[sum + cur] ?? 0;
}

function tinfDecodeTrees(d: Data, lt: Tree, dt: Tree): void {
  const hlit = tinfReadBits(d, 5, 257);
  const hdist = tinfReadBits(d, 5, 1);
  const hclen = tinfReadBits(d, 4, 4);

  for (let i = 0; i < 19; i += 1) lengths[i] = 0;

  for (let i = 0; i < hclen; i += 1) {
    lengths[clcidx[i] ?? 0] = tinfReadBits(d, 3, 0);
  }

  tinfBuildTree(codeTree, lengths, 0, 19);

  let num = 0;
  while (num < hlit + hdist) {
    const sym = tinfDecodeSymbol(d, codeTree);
    if (sym === 16) {
      const prev = lengths[num - 1] ?? 0;
      const repeat = tinfReadBits(d, 2, 3);
      for (let i = 0; i < repeat; i += 1) {
        lengths[num++] = prev;
      }
    } else if (sym === 17) {
      const repeat = tinfReadBits(d, 3, 3);
      for (let i = 0; i < repeat; i += 1) {
        lengths[num++] = 0;
      }
    } else if (sym === 18) {
      const repeat = tinfReadBits(d, 7, 11);
      for (let i = 0; i < repeat; i += 1) {
        lengths[num++] = 0;
      }
    } else {
      lengths[num++] = sym;
    }
  }

  tinfBuildTree(lt, lengths, 0, hlit);
  tinfBuildTree(dt, lengths, hlit, hdist);
}

function tinfInflateBlockData(d: Data, lt: Tree, dt: Tree): number {
  while (true) {
    const sym = tinfDecodeSymbol(d, lt);
    if (sym === 256) {
      return TINF_OK;
    }

    if (sym < 256) {
      d.dest[d.destLen] = sym;
      d.destLen += 1;
    } else {
      const code = sym - 257;
      const length = tinfReadBits(d, lengthBits[code] ?? 0, lengthBase[code] ?? 0);
      const distCode = tinfDecodeSymbol(d, dt);
      const offset = d.destLen - tinfReadBits(d, distBits[distCode] ?? 0, distBase[distCode] ?? 0);
      for (let i = offset; i < offset + length; i += 1) {
        d.dest[d.destLen] = d.dest[i] ?? 0;
        d.destLen += 1;
      }
    }
  }
}

function tinfInflateUncompressedBlock(d: Data): number {
  while (d.bitcount > 8) {
    d.sourceIndex -= 1;
    d.bitcount -= 8;
  }

  const b0 = d.source[d.sourceIndex] ?? 0;
  const b1 = d.source[d.sourceIndex + 1] ?? 0;
  const b2 = d.source[d.sourceIndex + 2] ?? 0;
  const b3 = d.source[d.sourceIndex + 3] ?? 0;
  const length = 256 * b1 + b0;
  const invlength = 256 * b3 + b2;

  if (length !== (~invlength & 0x0000ffff)) {
    return TINF_DATA_ERROR;
  }

  d.sourceIndex += 4;
  for (let i = length; i > 0; i -= 1) {
    d.dest[d.destLen] = d.source[d.sourceIndex] ?? 0;
    d.destLen += 1;
    d.sourceIndex += 1;
  }

  d.bitcount = 0;
  return TINF_OK;
}

function tinfUncompress(source: Uint8Array, dest: Uint8Array): Uint8Array {
  const d = new Data(source, dest);
  let res = TINF_OK;
  let bfinal = 0;

  do {
    bfinal = tinfGetbit(d);
    const btype = tinfReadBits(d, 2, 0);

    if (btype === 0) {
      res = tinfInflateUncompressedBlock(d);
    } else if (btype === 1) {
      res = tinfInflateBlockData(d, sltree, sdtree);
    } else if (btype === 2) {
      tinfDecodeTrees(d, d.ltree, d.dtree);
      res = tinfInflateBlockData(d, d.ltree, d.dtree);
    } else {
      res = TINF_DATA_ERROR;
    }

    if (res !== TINF_OK) {
      throw new Error('Data error');
    }
  } while (!bfinal);

  return d.dest.subarray(0, d.destLen);
}

tinfBuildFixedTrees(sltree, sdtree);
tinfBuildBitsBase(lengthBits, lengthBase, 4, 3);
tinfBuildBitsBase(distBits, distBase, 2, 1);
lengthBits[28] = 0;
lengthBase[28] = 258;

export function inflateRawDeflate(input: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length * 20);
  return tinfUncompress(input, output);
}
