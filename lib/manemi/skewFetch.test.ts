import test from "node:test";
import assert from "node:assert/strict";
import { withClockSkewRetry } from "./skewFetch.ts";

const future = () =>
  new Response('{"code":"PGRST303","details":null,"hint":null,"message":"JWT issued at future"}', { status: 401 });

test("retries 'JWT issued at future' until it succeeds", async () => {
  let calls = 0;
  const f = withClockSkewRetry(async () => (++calls < 3 ? future() : new Response("[]", { status: 200 })), [1, 1, 1]);
  const res = await f("https://x.test/rest/v1/a");
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

test("gives up after the last delay and returns the 401", async () => {
  let calls = 0;
  const f = withClockSkewRetry(async () => (calls++, future()), [1, 1]);
  const res = await f("https://x.test/rest/v1/a");
  assert.equal(res.status, 401);
  assert.equal(calls, 3);
});

test("does not retry other 401s or other statuses", async () => {
  let calls = 0;
  const f = withClockSkewRetry(
    async () => (calls++, new Response('{"code":"PGRST301","message":"JWT expired"}', { status: 401 })),
    [1, 1],
  );
  assert.equal((await f("https://x.test/rest/v1/a")).status, 401);
  assert.equal(calls, 1);
  const g = withClockSkewRetry(async () => new Response("x", { status: 500 }), [1]);
  assert.equal((await g("https://x.test/")).status, 500);
});
