import test from "node:test";
import assert from "node:assert/strict";
import { OrvexaStore } from "./store.ts";

test("Spec §12 & §14.6: order_processor without approval authority cannot approve orders", () => {
  const store = new OrvexaStore();
  const orgId = "11111111-1111-1111-1111-111111111111";
  const processor = store.getMember("22222222-2222-2222-2222-222222222223")!;
  const owner = store.getMember("22222222-2222-2222-2222-222222222221")!;

  const order = store.createOrderFromIntake(
    orgId,
    processor.userId,
    "3 reel elsewedy 3x16",
    "33333333-3333-3333-3333-333333333301",
    { overall_feasible: true },
    "needs_review"
  );

  assert.throws(
    () => store.decideOrder(processor, order.id, "approved"),
    /FORBIDDEN_APPROVAL_AUTHORITY/
  );

  const approved = store.decideOrder(owner, order.id, "approved");
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedByUserId, owner.userId);
});

test("Spec §14.9: multi-tenant order isolation prevents cross-org access", () => {
  const store = new OrvexaStore();
  const orgInd = "11111111-1111-1111-1111-111111111111";
  const orgMed = "11111111-1111-1111-1111-111111111112";

  const order = store.createOrderFromIntake(
    orgInd,
    "22222222-2222-2222-2222-222222222221",
    "test enterprise PO",
    null,
    { overall_feasible: true },
    "needs_review"
  );

  assert.equal(store.getOrder(orgMed, order.id), undefined);
  assert.equal(store.listOrders(orgMed).length, 0);
});
