export interface ConstrainedImageSize {
  width: number;
  height: number;
}

export function constrainImageSizeToMaxDimension(
  sourceWidthRaw: number,
  sourceHeightRaw: number,
  maxDimensionRaw: number
): ConstrainedImageSize {
  if (!Number.isFinite(sourceWidthRaw) || sourceWidthRaw <= 0) {
    throw new Error(`sourceWidth must be a positive finite number, got '${sourceWidthRaw}'.`);
  }
  if (!Number.isFinite(sourceHeightRaw) || sourceHeightRaw <= 0) {
    throw new Error(`sourceHeight must be a positive finite number, got '${sourceHeightRaw}'.`);
  }
  if (!Number.isFinite(maxDimensionRaw) || maxDimensionRaw <= 0) {
    throw new Error(`maxDimension must be a positive finite number, got '${maxDimensionRaw}'.`);
  }

  const sourceWidth = Math.max(1, Math.round(sourceWidthRaw));
  const sourceHeight = Math.max(1, Math.round(sourceHeightRaw));
  const maxDimension = Math.max(1, Math.round(maxDimensionRaw));

  if (sourceWidth >= sourceHeight) {
    return {
      width: maxDimension,
      height: Math.max(1, Math.round((maxDimension * sourceHeight) / sourceWidth))
    };
  }
  return {
    width: Math.max(1, Math.round((maxDimension * sourceWidth) / sourceHeight)),
    height: maxDimension
  };
}
