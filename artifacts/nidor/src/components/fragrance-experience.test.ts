import assert from "node:assert/strict";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import type { Fragrance } from "@/data/fragrances";
import { FragranceExperience } from "./fragrance-experience";

Object.assign(globalThis, { React });

const fragrance: Fragrance = {
  id: "quiet-garden",
  slug: "quiet-garden",
  number: "01",
  name: "Quiet Garden",
  brand: "NIDOR",
  house: "NIDOR",
  image: "/fragrances/quiet-garden.jpg",
  theme: { surface: "#dfe7dc", deep: "#334033", accent: "#7c9b73", light: true },
  description: "A green, quiet fragrance.",
  story: "A garden after rain.",
  notes: [],
  visual: { scale: 1, x: 0.5, y: 0.5, rotation: 0 },
  variants: [
    {
      id: "active-decant",
      variantType: "decant",
      sizeMl: 5,
      sku: "QG-5",
      priceLkr: 1250,
      priceNeedsConfiguration: false,
      stockQuantity: 4,
      stockNeedsConfiguration: false,
      isActive: true,
    },
    {
      id: "inactive-bottle",
      variantType: "full_bottle",
      sizeMl: 50,
      sku: "QG-50",
      priceLkr: 12000,
      priceNeedsConfiguration: false,
      stockQuantity: 2,
      stockNeedsConfiguration: false,
      isActive: false,
    },
    {
      id: "unpriced-decant",
      variantType: "decant",
      sizeMl: 10,
      sku: "QG-10",
      priceLkr: null,
      priceNeedsConfiguration: true,
      stockQuantity: 4,
      stockNeedsConfiguration: false,
      isActive: true,
    },
    {
      id: "unconfigured-stock-bottle",
      variantType: "full_bottle",
      sizeMl: 50,
      sku: "QG-50-U",
      priceLkr: 12000,
      priceNeedsConfiguration: false,
      stockQuantity: 0,
      stockNeedsConfiguration: true,
      isActive: true,
    },
  ],
};

test("fragrance format selector hides inactive and unconfigured variants", () => {
  const markup = renderToStaticMarkup(createElement(FragranceExperience, {
    fragrance,
    previousWorld: "#242d40",
    selectedVariantId: "active-decant",
    onVariantChange: () => {},
    onAdd: () => {},
  }));

  assert.match(markup, /data-testid="button-variant-quiet-garden-active-decant"/);
  assert.match(markup, /aria-pressed="true"/);
  assert.doesNotMatch(markup, /data-testid="button-variant-quiet-garden-inactive-bottle"/);
  assert.doesNotMatch(markup, /data-testid="button-variant-quiet-garden-unpriced-decant"/);
  assert.doesNotMatch(markup, /data-testid="button-variant-quiet-garden-unconfigured-stock-bottle"/);
});

test("fragrance details show configured values and omit missing values", () => {
  const configuredMarkup = renderToStaticMarkup(createElement(FragranceExperience, {
    fragrance: {
      ...fragrance,
      family: "  Green aromatic  ",
      gender: "Unisex",
      concentration: "Eau de parfum",
    },
    previousWorld: "#242d40",
    selectedVariantId: "active-decant",
    onVariantChange: () => {},
    onAdd: () => {},
  }));

  assert.match(configuredMarkup, /<dt>Family<\/dt><dd>Green aromatic<\/dd>/);
  assert.match(configuredMarkup, /<dt>Audience<\/dt><dd>Unisex<\/dd>/);
  assert.match(configuredMarkup, /<dt>Concentration<\/dt><dd>Eau de parfum<\/dd>/);

  const partialMarkup = renderToStaticMarkup(createElement(FragranceExperience, {
    fragrance: { ...fragrance, family: "Green", gender: " ", concentration: undefined },
    previousWorld: "#242d40",
    selectedVariantId: "active-decant",
    onVariantChange: () => {},
    onAdd: () => {},
  }));

  assert.match(partialMarkup, /<dt>Family<\/dt><dd>Green<\/dd>/);
  assert.doesNotMatch(partialMarkup, /<dt>Audience<\/dt>/);
  assert.doesNotMatch(partialMarkup, /<dt>Concentration<\/dt>/);
});

test("read-only preview shows all format price and stock states without cart controls", () => {
  const markup = renderToStaticMarkup(createElement(FragranceExperience, {
    fragrance,
    previousWorld: "#242d40",
    selectedVariantId: "active-decant",
    onVariantChange: () => {},
    onAdd: () => {},
    previewOnly: true,
  }));

  assert.match(markup, /data-testid="preview-format-audit-quiet-garden"/);
  assert.match(markup, /data-testid="preview-format-status-quiet-garden-active-decant"/);
  assert.match(markup, /data-testid="preview-format-status-quiet-garden-unpriced-decant"/);
  assert.match(markup, /data-testid="preview-format-status-quiet-garden-inactive-bottle"/);
  assert.match(markup, /Price not configured/);
  assert.match(markup, /Stock needs verification/);
  assert.match(markup, /Paused/);
  assert.match(markup, /Preview only · no cart action/);
  assert.doesNotMatch(markup, /data-testid="button-add-quiet-garden"/);
  assert.doesNotMatch(markup, /Quantity/);
});
