/**
 * Dry-run stacker reconciliation against example Cloudflare data.
 * Run with: node test-stacker-data.js
 */

import {
  plateSimilarity,
  platesLookLikeSameVehicle,
  reconcileStackerResponse,
} from "./helpers/stacker-data.js";

const EXAMPLE_RESPONSE = {
  timestamp: "2026-07-29T05:36:53.519Z",
  cars: {
    cars: [
      { stacker: 1, level: 1, plate: "PNY972", confidence: 0.95 },
      { stacker: 1, level: 2, plate: "EMPTY", confidence: 0.99 },
      { stacker: 1, level: 3, plate: "EMPTY", confidence: 0.99 },
      { stacker: 1, level: 4, plate: "EMPTY", confidence: 0.99 },
      { stacker: 2, level: 1, plate: "RNY158", confidence: 0.95 },
      { stacker: 2, level: 2, plate: "RBK586", confidence: 0.95 },
      { stacker: 2, level: 3, plate: "EMPTY", confidence: 0.99 },
      { stacker: 2, level: 4, plate: "EMPTY", confidence: 0.99 },
      { stacker: 3, level: 1, plate: "RBY844", confidence: 0.95 },
      { stacker: 3, level: 2, plate: "MS911S", confidence: 0.95 },
      { stacker: 3, level: 3, plate: "RTU499", confidence: 0.95 },
      { stacker: 3, level: 4, plate: "RJB96", confidence: 0.9 },
      { stacker: 4, level: 1, plate: "I G63 I", confidence: 0.95 },
      { stacker: 4, level: 2, plate: "EMPTY", confidence: 0.99 },
      { stacker: 4, level: 3, plate: "RA6425", confidence: 0.95 },
      { stacker: 4, level: 4, plate: "EMPTY", confidence: 0.99 },
      { stacker: 5, level: 1, plate: "LAAMBO", confidence: 0.95 },
      { stacker: 5, level: 2, plate: "RMK524", confidence: 0.95 },
      { stacker: 5, level: 3, plate: "UNKNOWN", confidence: 0.85 },
      { stacker: 5, level: 4, plate: "EMPTY", confidence: 0.99 },
      { stacker: 6, level: 1, plate: "NU620", confidence: 0.9 },
      { stacker: 6, level: 2, plate: "JM4664", confidence: 0.9 },
      { stacker: 6, level: 3, plate: "R8XS", confidence: 0.85 },
      { stacker: 6, level: 4, plate: "UNKNOWN", confidence: 0.85 },
    ],
  },
};

const KNOWN_PLATES = [
  "PNY972",
  "RNY158",
  "RBK586",
  "RBY844",
  "MS911S",
  "RTU499",
  "RJB96",
  "IG63I",
  "RA6425",
  "LAAMBO",
  "RMK524",
  "NU620",
  "JM4664",
  "R8MS",
];

const reconciled = reconcileStackerResponse(EXAMPLE_RESPONSE, KNOWN_PLATES);

console.log("OCR similarity checks:\n");
console.log(
  `RDN95 vs R8MS: similarity=${plateSimilarity("RDN95", "R8MS").toFixed(3)} sameVehicle=${platesLookLikeSameVehicle("RDN95", "R8MS")}`,
);
console.log(
  `R8XS vs R8MS: similarity=${plateSimilarity("R8XS", "R8MS").toFixed(3)} sameVehicle=${platesLookLikeSameVehicle("R8XS", "R8MS")}`,
);

const previousSlots = [
  { stacker: 6, level: 3, plate: "R8MS", confidence: 0.95 },
];
const misreadResponse = {
  timestamp: "2026-08-03T04:00:00.000Z",
  cars: {
    cars: [
      { stacker: 6, level: 3, plate: "RDN95", confidence: 0.85 },
    ],
  },
};
const misreadReconciled = reconcileStackerResponse(
  misreadResponse,
  KNOWN_PLATES,
  previousSlots,
);
console.log(
  `\nPrevious-plate fallback: RDN95 -> ${misreadReconciled.cars.cars[0]?.plate} (expected R8MS)\n`,
);

console.log("Reconciled stacker data:\n");
for (const slot of reconciled.cars.cars) {
  const raw = EXAMPLE_RESPONSE.cars.cars.find(
    (item) => item.stacker === slot.stacker && item.level === slot.level,
  );
  const changed = raw && raw.plate !== slot.plate ? " *" : "";
  console.log(
    `S${slot.stacker} L${slot.level}: ${raw?.plate ?? "?"} -> ${slot.plate}${changed}`,
  );
}
