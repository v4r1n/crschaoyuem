'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, createEquipment, createUser, expectError, expectOk } =
  require('./test-helpers.cjs');

const GIF = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64');

function attachImage(harness, equipment) {
  const fileId = 'private-equipment-image';
  let trashed = false;
  let bytes = GIF;
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'image_file_id', fileId);
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'image_url',
    'https://drive.google.com/thumbnail?id=' + fileId);
  harness.context.DriveApp.getFileById = (id) => {
    if (id !== fileId) throw new Error('File unavailable');
    return {
      isTrashed: () => trashed,
      getMimeType: () => 'image/gif',
      getSize: () => bytes.length,
      getBlob: () => ({ getBytes: () => [...bytes], getContentType: () => 'image/gif' })
    };
  };
  return {
    trash() { trashed = true; },
    replaceBytes(value) { bytes = value; }
  };
}

test('authenticated image delivery reads only the Equipment referenced Drive file', () => {
  const h = bootstrappedHarness();
  const equipment = createEquipment(h, { suffix: 'protected-delivery' });
  attachImage(h, equipment);
  const other = createEquipment(h, { suffix: 'no-image' });
  const user = createUser(h, { suffix: 'image-reader' });
  h.signInAs(user.email);

  const image = expectOk(h.invoke('getEquipmentImage', equipment.asset_id, equipment.row_version));
  assert.equal(image.available, true);
  assert.equal(image.mime_type, 'image/gif');
  assert.equal(image.base64_data, GIF.toString('base64'));
  assert.equal(image.row_version, equipment.row_version);
  assert.equal(Object.hasOwn(image, 'file_id'), false);
  expectError(h.invokeWithToken('getEquipmentImage', '', equipment.asset_id,
    equipment.row_version), 'UNAUTHENTICATED');
  assert.equal(expectOk(h.invoke('getEquipmentImage', other.asset_id,
    other.row_version)).available, false);
});

test('protected image delivery rejects stale, trashed, and malformed content', () => {
  const h = bootstrappedHarness();
  const equipment = createEquipment(h, { suffix: 'stale-delivery' });
  const image = attachImage(h, equipment);
  assert.equal(expectOk(h.invoke('getEquipmentImage', equipment.asset_id,
    equipment.row_version - 1)).reason, 'STALE_VERSION');
  image.replaceBytes(Buffer.from('not an image'));
  assert.equal(expectOk(h.invoke('getEquipmentImage', equipment.asset_id,
    equipment.row_version)).available, false);
  image.trash();
  assert.equal(expectOk(h.invoke('getEquipmentImage', equipment.asset_id,
    equipment.row_version)).reason, 'IMAGE_UNAVAILABLE');
});
