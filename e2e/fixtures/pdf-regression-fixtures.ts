import { createHash } from 'node:crypto';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';

const PASSWORD_PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

function md5(value: Buffer): Buffer {
  return createHash('md5').update(value).digest();
}

function padPassword(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PADDING]).subarray(0, 32);
}

/** RC4 is used only to generate a tiny deterministic PDF test fixture (R2/40-bit). */
function rc4(key: Buffer, input: Buffer): Buffer {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;

  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }

  const output = Buffer.alloc(input.length);
  let i = 0;
  j = 0;

  for (let offset = 0; offset < input.length; offset += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    const streamByte = state[(state[i] + state[j]) & 0xff];
    output[offset] = input[offset] ^ streamByte;
  }

  return output;
}

function encryptObject(fileKey: Buffer, objectNumber: number, plainText: Buffer): Buffer {
  const objectKeyMaterial = Buffer.concat([
    fileKey,
    Buffer.from([
      objectNumber & 0xff,
      (objectNumber >> 8) & 0xff,
      (objectNumber >> 16) & 0xff,
      0,
      0
    ])
  ]);
  const objectKey = md5(objectKeyMaterial).subarray(0, Math.min(fileKey.length + 5, 16));
  return rc4(objectKey, plainText);
}

function assemblePdf(objects: Buffer[], fileId: Buffer, encryptObjectNumber?: number): Buffer {
  const header = Buffer.from('%PDF-1.4\n', 'ascii');
  const chunks: Buffer[] = [header];
  const offsets = [0];
  let byteOffset = header.length;

  objects.forEach((object, index) => {
    offsets.push(byteOffset);
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'ascii'),
      object,
      Buffer.from('\nendobj\n', 'ascii')
    ]);
    chunks.push(wrapped);
    byteOffset += wrapped.length;
  });

  const crossReferenceOffset = byteOffset;
  const crossReference = [
    `xref\n0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
  ].join('\n') + '\n';

  let trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R`;
  if (encryptObjectNumber) trailer += ` /Encrypt ${encryptObjectNumber} 0 R`;
  trailer += ` /ID [<${fileId.toString('hex')}><${fileId.toString('hex')}>] >>\n`;
  trailer += `startxref\n${crossReferenceOffset}\n%%EOF\n`;

  chunks.push(Buffer.from(crossReference + trailer, 'ascii'));
  return Buffer.concat(chunks);
}

export async function createImageAndPageBoxesPdf(pngBytes: Uint8Array): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const image = await document.embedPng(pngBytes);

  const firstPage = document.addPage([612, 792]);
  firstPage.drawText('TEXT AND IMAGE REGRESSION FIXTURE', {
    x: 72,
    y: 720,
    size: 20,
    font
  });
  firstPage.drawImage(image, {
    x: 100,
    y: 400,
    width: 100,
    height: 100
  });

  const rotatedPage = document.addPage([500, 700]);
  rotatedPage.setCropBox(20, 30, 420, 620);
  rotatedPage.setRotation(degrees(90));
  rotatedPage.drawText('ROTATED PAGE WITH CUSTOM CROP BOX', {
    x: 50,
    y: 580,
    size: 16,
    font
  });

  return Buffer.from(await document.save());
}

/**
 * Creates a minimal, valid Standard Security Handler revision-2 PDF.
 * Test credentials are user password "user-secret" and owner password "owner-secret".
 * The viewer currently has no password-entry flow; tests assert safe rejection.
 */
export function createPasswordProtectedPdf(): Buffer {
  const userPassword = 'user-secret';
  const ownerPassword = 'owner-secret';
  const fileId = Buffer.from('0123456789abcdef', 'ascii');
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4, 0);

  const ownerKey = md5(padPassword(ownerPassword)).subarray(0, 5);
  const ownerEntry = rc4(ownerKey, padPassword(userPassword));
  const fileKey = md5(Buffer.concat([
    padPassword(userPassword),
    ownerEntry,
    permissions,
    fileId
  ])).subarray(0, 5);
  const userEntry = rc4(fileKey, PASSWORD_PADDING);

  const content = Buffer.from(
    'BT /F1 24 Tf 72 720 Td (PASSWORD PROTECTED PDF FIXTURE) Tj ET',
    'ascii'
  );
  const encryptedContent = encryptObject(fileKey, 5, content);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      'ascii'
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'ascii'),
    Buffer.concat([
      Buffer.from(`<< /Length ${encryptedContent.length} >>\nstream\n`, 'ascii'),
      encryptedContent,
      Buffer.from('\nendstream', 'ascii')
    ]),
    Buffer.from(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${ownerEntry.toString('hex')}> ` +
      `/U <${userEntry.toString('hex')}> /P -4 >>`,
      'ascii'
    )
  ];

  return assemblePdf(objects, fileId, 6);
}

export function createTruncatedPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.7\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '%%EOF\n',
    'ascii'
  );
}
