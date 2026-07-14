/** Minimal PNG `wbZt` locket chunk reader (no canvas / glitter fallback). */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LOCKET_PNG_CHUNK = 'wbZt';

let crcTable = null;
function getCrcTable() {
	if (crcTable) return crcTable;
	crcTable = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		crcTable[n] = c >>> 0;
	}
	return crcTable;
}

function crc32(bytes) {
	const table = getCrcTable();
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i += 1) {
		crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes, offset) {
	return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function isPngBytes(bytes) {
	if (!bytes || bytes.length < PNG_SIGNATURE.length) return false;
	return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function chunkTypeAt(bytes, offset) {
	return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string|null} embedded .wult/.vult share text
 */
export function extractLocketShareText(bytes) {
	if (!isPngBytes(bytes)) return null;
	let offset = PNG_SIGNATURE.length;
	while (offset + 12 <= bytes.length) {
		const length = readUint32(bytes, offset);
		const type = chunkTypeAt(bytes, offset + 4);
		if (type === LOCKET_PNG_CHUNK && offset + 12 + length <= bytes.length) {
			const body = bytes.subarray(offset + 8, offset + 8 + length);
			const crcInput = new Uint8Array(4 + body.length);
			crcInput[0] = LOCKET_PNG_CHUNK.charCodeAt(0);
			crcInput[1] = LOCKET_PNG_CHUNK.charCodeAt(1);
			crcInput[2] = LOCKET_PNG_CHUNK.charCodeAt(2);
			crcInput[3] = LOCKET_PNG_CHUNK.charCodeAt(3);
			crcInput.set(body, 4);
			const expected = readUint32(bytes, offset + 8 + length);
			if (crc32(crcInput) !== expected) return null;
			try {
				const parsed = JSON.parse(new TextDecoder().decode(body));
				if (parsed && typeof parsed.content === 'string' && parsed.content.trim()) {
					return parsed.content.trim();
				}
			} catch { /* ignore */ }
			return null;
		}
		offset += 12 + length;
	}
	return null;
}
