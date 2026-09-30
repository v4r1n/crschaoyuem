'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, createEquipment, expectOk } = require('./test-helpers.cjs');

test('account-routed config never persists or returns account-routed equipment links', () => {
  const harness = bootstrappedHarness();
  const base = 'https://script.google.com/macros/s/test-deployment/exec';
  let equipment;

  for (const account of [0, 1, 2]) {
    harness.properties.setProperty('WEB_APP_URL',
      base.replace('/macros/s/', `/macros/u/${account}/s/`));
    equipment = createEquipment(harness, { suffix: `url-${account}` });
    const expected = `${base}?view=equipment-detail&id=${equipment.asset_id}`;
    assert.equal(equipment.qr_url, expected);
    assert.equal(harness.find('Equipment', 'asset_id', equipment.asset_id).qr_url, expected);
  }

  const stale = base.replace('/macros/s/', '/macros/u/2/s/') +
    `?view=equipment-detail&id=${equipment.asset_id}`;
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'qr_url', stale);
  assert.equal(expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id)).qr_url,
    `${base}?view=equipment-detail&id=${equipment.asset_id}`);

  const edited = expectOk(harness.invoke('adminUpdateEquipment', {
    command_id: 'refresh-account-routed-qr-cache',
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    sku: equipment.sku,
    name: equipment.name,
    category_id: equipment.category_id,
    brand: equipment.brand,
    model: equipment.model,
    serial_number: equipment.serial_number,
    specification: equipment.specification,
    description: equipment.description,
    department: equipment.department,
    location: equipment.location,
    note: equipment.note
  }));
  assert.equal(harness.find('Equipment', 'asset_id', equipment.asset_id).qr_url,
    edited.qr_url);

  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'qr_url', stale);
  harness.properties.setProperty('WEB_APP_URL', '');
  assert.equal(expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id)).qr_url, '');
});
