// Run: node --test lib/lead-match.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadMatchesSearch } from "./lead-match.ts";

const maps = (mapsSearchString: string, city = "Miami") => ({
  mapsSearchString,
  locationQuery: `${city}, FL, USA`,
});

// Rows shaped like Google Maps library rows (name/company = title, industry = category).
const row = (name: string, industry: string, location = "Miami, FL") => ({
  name,
  company: name,
  title: "",
  industry,
  location,
});

test("restaurants in Miami never returns barbers (the reported bug)", () => {
  const f = maps("restaurants");
  assert.equal(leadMatchesSearch("google_maps", f, row("Fade Kings", "Barber shop")), false);
  assert.equal(leadMatchesSearch("google_maps", f, row("Miami Cuts", "Barber shop")), false);
  assert.equal(leadMatchesSearch("google_maps", f, row("Glow Med Spa", "Medical spa")), false);
  assert.equal(leadMatchesSearch("google_maps", f, row("Versailles", "Cuban restaurant")), true);
  assert.equal(leadMatchesSearch("google_maps", f, row("Joe's Stone Crab", "Seafood restaurant")), true);
});

test("place word in a business name doesn't count as the business type", () => {
  // Searching "restaurants in Miami" — "Miami Barber Co" mentions Miami but isn't a restaurant.
  assert.equal(
    leadMatchesSearch("google_maps", maps("restaurants"), row("Miami Barber Co", "Barber shop")),
    false,
  );
});

test("wrong city is rejected even when the type matches", () => {
  const f = maps("restaurants");
  assert.equal(leadMatchesSearch("google_maps", f, row("Pecan Lodge", "Barbecue restaurant", "Dallas, TX")), false);
  assert.equal(leadMatchesSearch("google_maps", f, row("Miami Grill", "Cuban restaurant", "Orlando, FL")), false);
});

test("no prefix matching: bars ≠ barbers", () => {
  const f = maps("bars");
  assert.equal(leadMatchesSearch("google_maps", f, row("Fade Kings", "Barber shop")), false);
  assert.equal(leadMatchesSearch("google_maps", f, row("Sweet Liberty", "Cocktail bar")), true);
});

test("plural/singular and med/medical wording still match", () => {
  assert.equal(leadMatchesSearch("google_maps", maps("medical spas"), row("Glow", "Medical spa")), true);
  assert.equal(leadMatchesSearch("google_maps", maps("med spa"), row("Glow", "Medical spa")), true);
  assert.equal(leadMatchesSearch("google_maps", maps("bakeries"), row("Zak", "Bakery")), true);
  assert.equal(leadMatchesSearch("google_maps", maps("dentists"), row("Smile", "Dental clinic")), true);
});

test("filler words are ignored, real type words are required", () => {
  assert.equal(leadMatchesSearch("google_maps", maps("pizza places"), row("Lucali", "Pizza restaurant")), true);
  assert.equal(leadMatchesSearch("google_maps", maps("pizza places"), row("Fade Kings", "Barber shop")), false);
  assert.equal(leadMatchesSearch("google_maps", maps("italian restaurants"), row("Joe's", "Seafood restaurant")), false);
});

test("searches with no place or no business type never use the fallback", () => {
  assert.equal(leadMatchesSearch("google_maps", { mapsSearchString: "restaurants" }, row("V", "Cuban restaurant")), false);
  assert.equal(leadMatchesSearch("google_maps", maps("places"), row("V", "Cuban restaurant")), false);
});

test("linkedin: title must match, industry words must match", () => {
  const f = { jobTitles: ["Owner", "Founder"], industry: "Software", city: "Miami" };
  const person = (title: string, industry: string) => ({
    name: "Ana Diaz", company: "Acme", title, industry, location: "Miami, Florida, United States",
  });
  assert.equal(leadMatchesSearch("linkedin", f, person("Co-Founder & CEO", "Software Development")), true);
  assert.equal(leadMatchesSearch("linkedin", f, person("Barber", "Software Development")), false);
  assert.equal(leadMatchesSearch("linkedin", f, person("Founder", "Hospitality")), false);
});

test("a wrongly-filed folder row is caught (found in dev data: Ohio restaurant in 'med spa · Miami')", () => {
  assert.equal(
    leadMatchesSearch("google_maps", maps("med spa"), row("Bender's", "Restaurant", "Canton, Ohio")),
    false,
  );
  assert.equal(leadMatchesSearch("google_maps", maps("restaurants"), row("Prime 112", "Steak house")), true);
});

test("realtor.com rows are never served from the keyword fallback", () => {
  assert.equal(leadMatchesSearch("realtor_agents", { city: "Miami" }, row("Jane", "Realtor")), false);
});
