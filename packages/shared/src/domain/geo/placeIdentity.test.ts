import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlaceIdentityKey } from "./placeIdentity.js";

test("oktmo+name: Казань и Самосырово с одним oktmo — разные ключи", () => {
  const region = "татарстан";
  const oktmo = "92701000";
  const kazan = resolvePlaceIdentityKey({
    regionKey: region,
    oktmo,
    kind: "city",
    name: "Казань",
  });
  const samos = resolvePlaceIdentityKey({
    regionKey: region,
    oktmo,
    kind: "locality",
    name: "Самосырово",
  });
  assert.notEqual(kazan, samos);
  assert.equal(kazan, `${region}:oktmo:${oktmo}:казань`);
});

test("fias побеждает oktmo+name", () => {
  const key = resolvePlaceIdentityKey({
    fiasId: "fias-guid-1",
    regionKey: "татарстан",
    oktmo: "92701000",
    kind: "city",
    name: "Казань",
  });
  assert.equal(key, "fias-guid-1");
});

test("без oktmo — region+kind+name", () => {
  assert.equal(
    resolvePlaceIdentityKey({
      regionKey: "кировская",
      kind: "locality",
      name: "Казань",
    }),
    "кировская:locality:казань",
  );
});

test("дубль oktmo+name — один ключ", () => {
  const input = {
    regionKey: "татарстан",
    oktmo: "92701000",
    kind: "city",
    name: "Казань",
  };
  assert.equal(resolvePlaceIdentityKey(input), resolvePlaceIdentityKey({ ...input }));
});
