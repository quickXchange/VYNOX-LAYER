import test from 'node:test';
import assert from 'node:assert/strict';
import { SubmitWhiteLabelRequestBody } from '@workspace/api-zod';

const input = { projectName: 'Example', brandName: 'Example', actions: ['swap'], details: '',
  idempotencyKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
test('new customer requests require a nonblank preferred domain', () => {
  for (const preferredDomain of [undefined, null, '', '   ', '\n\t']) {
    assert.equal(SubmitWhiteLabelRequestBody.safeParse({ ...input, preferredDomain }).success, false);
  }
  assert.equal(SubmitWhiteLabelRequestBody.safeParse({ ...input, preferredDomain: 'exchange.example.com' }).success, true);
});
