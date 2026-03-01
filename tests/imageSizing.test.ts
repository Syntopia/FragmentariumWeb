import { describe, expect, test } from "vitest";

import { constrainImageSizeToMaxDimension } from "../src/utils/imageSizing";

describe("constrainImageSizeToMaxDimension", () => {
  test("scales landscape size to requested max dimension", () => {
    expect(constrainImageSizeToMaxDimension(2000, 1000, 300)).toEqual({ width: 300, height: 150 });
  });

  test("scales portrait size to requested max dimension", () => {
    expect(constrainImageSizeToMaxDimension(1000, 2000, 300)).toEqual({ width: 150, height: 300 });
  });

  test("keeps square ratio and max dimension", () => {
    expect(constrainImageSizeToMaxDimension(1024, 1024, 300)).toEqual({ width: 300, height: 300 });
  });

  test("throws for invalid dimensions", () => {
    expect(() => constrainImageSizeToMaxDimension(0, 100, 300)).toThrow("sourceWidth");
    expect(() => constrainImageSizeToMaxDimension(100, 0, 300)).toThrow("sourceHeight");
    expect(() => constrainImageSizeToMaxDimension(100, 100, 0)).toThrow("maxDimension");
  });
});
