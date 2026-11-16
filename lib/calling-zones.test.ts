// Run: node --test lib/calling-zones.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countryZone } from "../convex/lib/callingZones.ts";

const NY = "America/New_York";

test("single-zone countries are placed from the calling code", () => {
  assert.deepEqual(countryZone("+447911123456", NY), { zone: "Europe/London" });
  assert.deepEqual(countryZone("+2348031234567", NY), { zone: "Africa/Lagos" });
  assert.deepEqual(countryZone("+919812345678", NY), { zone: "Asia/Kolkata" });
  assert.deepEqual(countryZone("+4915112345678", NY), { zone: "Europe/Berlin" });
  assert.deepEqual(countryZone("+353861234567", NY), { zone: "Europe/Dublin" });
  assert.deepEqual(countryZone("+212612345678", NY), { zone: "Africa/Casablanca" });
  assert.deepEqual(countryZone("+201012345678", NY), { zone: "Africa/Cairo" });
  assert.deepEqual(countryZone("+819012345678", NY), { zone: "Asia/Tokyo" });
});

test("US/Canada and unparseable numbers are left to the caller", () => {
  assert.equal(countryZone("+14155550123", NY), null);
  assert.equal(countryZone(null, NY), null);
  assert.equal(countryZone("+999123456", NY), null);
});

test("multi-zone countries use the default only when it's inside the country", () => {
  assert.deepEqual(countryZone("+61412345678", NY), { hold: "Australia" });
  assert.deepEqual(countryZone("+61412345678", "Australia/Perth"), { zone: "Australia/Perth" });
  assert.deepEqual(countryZone("+5511912345678", NY), { hold: "Brazil" });
  assert.deepEqual(countryZone("+5511912345678", "America/Sao_Paulo"), {
    zone: "America/Sao_Paulo",
  });
  assert.deepEqual(countryZone("+5215512345678", "America/Mexico_City"), {
    zone: "America/Mexico_City",
  });
  assert.deepEqual(countryZone("+79161234567", NY), { hold: "Russia/Kazakhstan" });
});

test("every zone named in the module is valid in this runtime", () => {
  const source = readFileSync(new URL("../convex/lib/callingZones.ts", import.meta.url), "utf8");
  const zones = [...source.matchAll(/"((?:Europe|Asia|Africa|America|Atlantic|Pacific|Indian|Australia)\/[A-Za-z_/-]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(zones.length > 80);
  for (const zone of zones) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: zone }), zone);
  }
});

test("the qualifier page's timezone choices are all valid", () => {
  const page = readFileSync(
    new URL("../components/voice/qualifier-client.tsx", import.meta.url),
    "utf8",
  );
  const block = page.slice(page.indexOf("CALLING_TIMEZONES"), page.indexOf("];"));
  const zones = [...block.matchAll(/value: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(zones.length >= 20);
  for (const zone of zones) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: zone }), zone);
  }
});
