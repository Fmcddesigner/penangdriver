const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const width = 1200;
const height = 630;
const row = Buffer.alloc(1 + width * 3);
const rows = [];
for (let y = 0; y < height; y++) {
  row[0] = 0;
  for (let x = 0; x < width; x++) {
    const i = 1 + x * 3;
    row[i] = 15;
    row[i + 1] = 17;
    row[i + 2] = 23;
  }
  rows.push(Buffer.from(row));
}
const raw = Buffer.concat(rows);
const compressed = zlib.deflateSync(raw);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 2;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'public', 'og-image.png');
fs.writeFileSync(out, png);
console.log('Wrote', out);
