/**
 * Dry-run stacker response normalization against example backend data.
 * Run with: node test-stacker-data.js
 */

import { reconcileStackerResponse } from "./helpers/stacker-data.js";

const EXAMPLE_RESPONSE = {
  generatedAt: "2026-08-26T04:20:46.139Z",
  snapshotSource: "test-image",
  model: {
    name: "facebook/dinov2-small",
    dimensions: 384,
  },
  fleet: {
    vehicleCount: 8,
  },
  thresholds: {
    minSimilarity: 0.6,
    minMargin: 0.03,
  },
  summary: {
    occupiedSpaces: 2,
    firstChoiceAssignments: 1,
    fallbackAssignments: 1,
    likelyEmptySpaces: 1,
    reviewSpaces: 1,
  },
  backendView: {
    occupiedSpaces: [
      {
        spaceId: "S3-L2",
        stacker: 3,
        level: 2,
        status: "occupied",
        confidence: "HIGH",
        vehicleId: "GT4-001",
        similarity: 0.9195,
      },
      {
        spaceId: "S4-L1",
        stacker: 4,
        level: 1,
        status: "occupied",
        confidence: "LOW",
        vehicleId: "R35-001",
        similarity: 0.6063,
      },
    ],
    emptySpaces: [
      {
        spaceId: "S1-L1",
        stacker: 1,
        level: 1,
        status: "likely-empty",
        confidence: "HIGH",
        similarity: 0.564,
      },
    ],
    reviewSpaces: [
      {
        spaceId: "S2-L2",
        stacker: 2,
        level: 2,
        status: "review",
        confidence: "MEDIUM",
        vehicleId: "CHECK-ME",
        similarity: 0.71,
      },
    ],
  },
};

const normalized = reconcileStackerResponse(EXAMPLE_RESPONSE);

console.log("Normalized stacker response:\n");
console.log(JSON.stringify(normalized, null, 2));
