export type TipShare = {
  participantId: string;
  percentageBasisPoints: number;
};

export type TipAllocation = {
  participantId: string;
  amountCents: number;
};

export type WeightedTipShare = {
  participantId: string;
  weightPoints: number;
};

export type ExperienceFactorShare = {
  participantId: string;
  factorHundredths: number;
};

export type PesoTipAllocation = {
  participantId: string;
  amountPesos: number;
};

export function allocateTipPool(
  totalAmountCents: number,
  shares: TipShare[],
): TipAllocation[] {
  if (!Number.isSafeInteger(totalAmountCents) || totalAmountCents < 0) {
    throw new RangeError("Tip pool must be a non-negative integer amount of cents");
  }

  const participantIds = new Set(shares.map(({ participantId }) => participantId));
  if (participantIds.size !== shares.length) {
    throw new TypeError("Each participant must appear exactly once");
  }

  if (
    shares.some(
      ({ percentageBasisPoints }) =>
        !Number.isInteger(percentageBasisPoints) || percentageBasisPoints < 0,
    )
  ) {
    throw new RangeError("Tip percentages must be non-negative integers");
  }

  const totalBasisPoints = shares.reduce(
    (sum, { percentageBasisPoints }) => sum + percentageBasisPoints,
    0,
  );
  if (totalBasisPoints !== 10_000) {
    throw new RangeError("Tip percentages must total 10000 basis points");
  }

  return allocateByUnits(
    totalAmountCents,
    shares.map(({ participantId, percentageBasisPoints }) => ({
      participantId,
      units: percentageBasisPoints,
    })),
    10_000,
  );
}

export function allocateTipPoolByWeights(
  totalAmountCents: number,
  shares: WeightedTipShare[],
): TipAllocation[] {
  if (!Number.isSafeInteger(totalAmountCents) || totalAmountCents < 0) {
    throw new RangeError("Tip pool must be a non-negative integer amount of cents");
  }

  const participantIds = new Set(shares.map(({ participantId }) => participantId));
  if (participantIds.size !== shares.length) {
    throw new TypeError("Each participant must appear exactly once");
  }
  if (
    shares.length === 0 ||
    shares.some(
      ({ weightPoints }) => !Number.isInteger(weightPoints) || weightPoints <= 0,
    )
  ) {
    throw new RangeError("Tip weights must be positive integers");
  }

  const totalWeight = shares.reduce(
    (sum, { weightPoints }) => sum + weightPoints,
    0,
  );

  return allocateByUnits(
    totalAmountCents,
    shares.map(({ participantId, weightPoints }) => ({
      participantId,
      units: weightPoints,
    })),
    totalWeight,
  );
}

/**
 * Divides a Chilean-peso tip pool using experience factors stored in
 * hundredths: 100 = 1.00 point, 75 = 0.75, 50 = 0.50, and 25 = 0.25.
 */
export function allocateTipPoolByExperienceFactors(
  totalAmountPesos: number,
  shares: ExperienceFactorShare[],
): PesoTipAllocation[] {
  const allocations = allocateTipPoolByWeights(
    totalAmountPesos,
    shares.map(({ participantId, factorHundredths }) => ({
      participantId,
      weightPoints: factorHundredths,
    })),
  );

  return allocations.map(({ participantId, amountCents }) => ({
    participantId,
    amountPesos: amountCents,
  }));
}

export function formatExperienceFactor(factorHundredths: number): string {
  if (!Number.isInteger(factorHundredths) || factorHundredths < 0) {
    throw new RangeError("Experience factor must be a non-negative integer");
  }

  const whole = Math.floor(factorHundredths / 100);
  const decimals = String(factorHundredths % 100).padStart(2, "0");
  return `${whole},${decimals}`;
}

function allocateByUnits(
  totalAmountCents: number,
  shares: Array<{ participantId: string; units: number }>,
  totalUnits: number,
): TipAllocation[] {
  const rankedRemainders = shares.map(({ participantId, units }, index) => {
    const numerator = BigInt(totalAmountCents) * BigInt(units);

    return {
      index,
      participantId,
      amountCents: Number(numerator / BigInt(totalUnits)),
      remainder: Number(numerator % BigInt(totalUnits)),
    };
  });
  const allocatedCents = rankedRemainders.reduce(
    (sum, allocation) => sum + allocation.amountCents,
    0,
  );
  const centsToAssign = totalAmountCents - allocatedCents;

  const remainderOrder = [...rankedRemainders].sort(
    (left, right) =>
      right.remainder - left.remainder ||
      left.participantId.localeCompare(right.participantId),
  );
  for (let index = 0; index < centsToAssign; index += 1) {
    remainderOrder[index].amountCents += 1;
  }

  return rankedRemainders
    .sort((left, right) => left.index - right.index)
    .map(({ participantId, amountCents }) => ({ participantId, amountCents }));
}
