import assert from 'assert'; import { check } from './no_content_logs.mjs';
assert.equal(check('console.log("feedback saved; mail not sent")').length, 0);
assert.equal(check('console.log(JSON.stringify({ evt: "moderation_error", kind: e.message }))').length, 0);
assert.equal(check('console.log(`sweep: warned=${warned}`)').length, 0);
assert.equal(check('console.log(body)').length, 1);
assert.equal(check('console.error("x", { text: m.body })').length, 1);
assert.equal(check('console.log(`got ${msg}`)').length, 1);
assert.equal(check('console.log("body text in a string is fine")').length, 0);
console.log('no_content_logs_test OK');
