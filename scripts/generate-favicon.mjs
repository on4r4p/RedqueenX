import fs from "node:fs";
import path from "node:path";

const size = 32;
const output = path.resolve("frontend/assets/favicon.ico");
fs.mkdirSync(path.dirname(output), { recursive: true });

const xorSize = size * size * 4;
const maskStride = Math.ceil(size / 32) * 4;
const maskSize = maskStride * size;
const dibSize = 40 + xorSize + maskSize;
const icoSize = 6 + 16 + dibSize;
const buffer = Buffer.alloc(icoSize);

let offset = 0;
buffer.writeUInt16LE(0, offset); offset += 2;
buffer.writeUInt16LE(1, offset); offset += 2;
buffer.writeUInt16LE(1, offset); offset += 2;
buffer.writeUInt8(size, offset); offset += 1;
buffer.writeUInt8(size, offset); offset += 1;
buffer.writeUInt8(0, offset); offset += 1;
buffer.writeUInt8(0, offset); offset += 1;
buffer.writeUInt16LE(1, offset); offset += 2;
buffer.writeUInt16LE(32, offset); offset += 2;
buffer.writeUInt32LE(dibSize, offset); offset += 4;
buffer.writeUInt32LE(22, offset); offset += 4;

buffer.writeUInt32LE(40, offset); offset += 4;
buffer.writeInt32LE(size, offset); offset += 4;
buffer.writeInt32LE(size * 2, offset); offset += 4;
buffer.writeUInt16LE(1, offset); offset += 2;
buffer.writeUInt16LE(32, offset); offset += 2;
buffer.writeUInt32LE(0, offset); offset += 4;
buffer.writeUInt32LE(xorSize + maskSize, offset); offset += 4;
buffer.writeInt32LE(0, offset); offset += 4;
buffer.writeInt32LE(0, offset); offset += 4;
buffer.writeUInt32LE(0, offset); offset += 4;
buffer.writeUInt32LE(0, offset); offset += 4;

const cyan = [0, 217, 255, 255];
const green = [116, 240, 180, 255];
const red = [196, 40, 72, 255];
const dark = [8, 19, 27, 255];
const transparent = [0, 0, 0, 0];

for (let y = size - 1; y >= 0; y -= 1) {
  for (let x = 0; x < size; x += 1) {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let color = transparent;
    if (dist <= 15) color = dark;
    if (dist >= 12.5 && dist <= 15) color = cyan;
    if (x >= 8 && x <= 13 && y >= 8 && y <= 23) color = red;
    if (x >= 13 && x <= 23 && y >= 8 && y <= 13) color = red;
    if (x >= 19 && x <= 23 && y >= 12 && y <= 18) color = red;
    if (x >= 18 && x <= 25 && y >= 20 && y <= 24) color = green;

    buffer.writeUInt8(color[0], offset); offset += 1;
    buffer.writeUInt8(color[1], offset); offset += 1;
    buffer.writeUInt8(color[2], offset); offset += 1;
    buffer.writeUInt8(color[3], offset); offset += 1;
  }
}

buffer.fill(0, offset, offset + maskSize);
fs.writeFileSync(output, buffer);
