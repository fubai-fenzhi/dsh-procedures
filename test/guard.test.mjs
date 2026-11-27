import assert from 'node:assert/strict';
import test from 'node:test';

import { routeRejection } from '../lib/guard.mjs';

const request = { headers: new Headers({ host: '127.0.0.1:1234' }) };

test('returns null when the connection accepts the request', () => {
  const connection = { requestRejection: () => undefined };
  assert.equal(routeRejection(connection, request), null);
});

test('returns the rejection status from the connection', () => {
  const connection = { requestRejection: () => 403 };
  assert.equal(routeRejection(connection, request), 403);
});

test('fails closed when the checker throws', () => {
  const throwing = { requestRejection: () => { throw new Error('boom'); } };
  assert.equal(routeRejection(throwing, request), 403);
});
