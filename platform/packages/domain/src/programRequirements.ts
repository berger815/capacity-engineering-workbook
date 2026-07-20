import type {
  CapacityModel,
  LeadTimePhase,
  Program,
  RequirementBasis,
  RoutingRequirement,
} from "./model.js";

export type ProgramRequirementBasis = Exclude<RequirementBasis, "perUnit">;

export interface CanonicalProgramRequirement {
  requirement: RoutingRequirement;
  basis: ProgramRequirementBasis;
  phase: LeadTimePhase;
  productId: string;
  revisionId: string;
  operationId: string;
}

export interface ProgramRequirementConflict {
  programId: string;
  requirementId: string;
  firstProductId: string;
  conflictingProductId: string;
}

export interface ProgramRequirementSet {
  records: CanonicalProgramRequirement[];
  conflicts: ProgramRequirementConflict[];
}

function activeRevision(model: CapacityModel, productId: string, date: string) {
  return model.routingRevisions
    .filter(revision => revision.productId === productId)
    .filter(revision => revision.effectiveFrom <= date && (!revision.effectiveTo || revision.effectiveTo >= date))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
}

function definitionSignature(record: CanonicalProgramRequirement): string {
  const { requirement, basis, phase } = record;
  return JSON.stringify({
    basis,
    resourceGroupId: requirement.resourceGroupId,
    requirement: requirement.requirement,
    setupQuantity: requirement.setupQuantity,
    setupRequirement: requirement.setupRequirement,
    batchSize: requirement.batchSize,
    phase: {
      startWeeksBeforeShip: phase.startWeeksBeforeShip,
      endWeeksBeforeShip: phase.endWeeksBeforeShip,
      allocation: phase.allocation,
    },
  });
}

/**
 * Resolves non-unit requirements once per program. A shared program requirement
 * may be repeated on member-product routes only when the canonical requirement
 * id and its complete definition are identical. Conflicting duplicates are
 * returned for validation rather than silently selected.
 */
export function canonicalProgramRequirements(
  model: CapacityModel,
  program: Program,
): ProgramRequirementSet {
  const records: CanonicalProgramRequirement[] = [];
  const conflicts: ProgramRequirementConflict[] = [];
  const seen = new Map<string, { signature: string; record: CanonicalProgramRequirement }>();

  for (const productId of program.productIds) {
    const revision = activeRevision(model, productId, program.anchorDate);
    if (!revision) continue;
    const phases = new Map(revision.phases.map(phase => [phase.id, phase]));

    for (const operation of revision.operations) {
      const phase = phases.get(operation.phaseId);
      if (!phase) continue;

      for (const requirement of operation.requirements) {
        const basis = requirement.basis ?? "perUnit";
        if (basis === "perUnit") continue;

        const record: CanonicalProgramRequirement = {
          requirement,
          basis,
          phase,
          productId,
          revisionId: revision.id,
          operationId: operation.id,
        };
        const signature = definitionSignature(record);
        const prior = seen.get(requirement.id);

        if (!prior) {
          seen.set(requirement.id, { signature, record });
          records.push(record);
          continue;
        }

        if (prior.signature !== signature) {
          conflicts.push({
            programId: program.id,
            requirementId: requirement.id,
            firstProductId: prior.record.productId,
            conflictingProductId: productId,
          });
        }
      }
    }
  }

  return { records, conflicts };
}
