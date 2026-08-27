export type StackerStatus = 'occupied' | 'likely-empty' | 'review'
export type StackerConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type StackerSpace = {
  spaceId: string
  stacker: number
  level: number
  status: StackerStatus
  confidence: StackerConfidence
  vehicleId: string | null
  similarity: number | null
}

export type CloudflareStackerData = {
  generatedAt: string | null
  snapshotSource: string | null
  model: {
    name: string | null
    dimensions: number | null
  } | null
  fleet: {
    vehicleCount: number | null
  } | null
  thresholds: Record<string, number>
  summary: {
    occupiedSpaces: number
    firstChoiceAssignments: number
    fallbackAssignments: number
    likelyEmptySpaces: number
    reviewSpaces: number
  }
  backendView: {
    occupiedSpaces: StackerSpace[]
    emptySpaces: StackerSpace[]
    reviewSpaces: StackerSpace[]
  }
}

export const STACKER_COUNT = 6
export const LEVEL_COUNT = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseStatus(value: unknown): StackerStatus {
  return value === 'occupied' || value === 'likely-empty' || value === 'review' ? value : 'review'
}

function parseConfidence(value: unknown): StackerConfidence {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW' ? value : 'LOW'
}

function parseSpace(value: unknown): StackerSpace | null {
  if (!isRecord(value)) return null

  const stacker = asNumber(value.stacker)
  const level = asNumber(value.level)
  const spaceId = asString(value.spaceId)

  if (stacker === null || level === null || !spaceId) return null

  return {
    spaceId,
    stacker,
    level,
    status: parseStatus(value.status),
    confidence: parseConfidence(value.confidence),
    vehicleId: asString(value.vehicleId),
    similarity: asNumber(value.similarity),
  }
}

function parseSpaces(value: unknown): StackerSpace[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => parseSpace(item))
    .filter((item): item is StackerSpace => item !== null)
    .sort((a, b) => a.stacker - b.stacker || a.level - b.level)
}

export function parseCloudflareStackerData(raw: unknown): CloudflareStackerData | null {
  if (!isRecord(raw)) return null

  const backendView = isRecord(raw.backendView) ? raw.backendView : {}
  const occupiedSpaces = parseSpaces(backendView.occupiedSpaces)
  const emptySpaces = parseSpaces(backendView.emptySpaces)
  const reviewSpaces = parseSpaces(backendView.reviewSpaces)
  const summary = isRecord(raw.summary) ? raw.summary : {}
  const model = isRecord(raw.model) ? raw.model : null
  const fleet = isRecord(raw.fleet) ? raw.fleet : null
  const thresholds = isRecord(raw.thresholds) ? raw.thresholds : {}

  return {
    generatedAt: asString(raw.generatedAt),
    snapshotSource: asString(raw.snapshotSource),
    model: model
      ? {
          name: asString(model.name),
          dimensions: asNumber(model.dimensions),
        }
      : null,
    fleet: fleet
      ? {
          vehicleCount: asNumber(fleet.vehicleCount),
        }
      : null,
    thresholds: Object.entries(thresholds).reduce<Record<string, number>>((acc, [key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        acc[key] = value
      }
      return acc
    }, {}),
    summary: {
      occupiedSpaces: asNumber(summary.occupiedSpaces) ?? occupiedSpaces.length,
      firstChoiceAssignments: asNumber(summary.firstChoiceAssignments) ?? 0,
      fallbackAssignments: asNumber(summary.fallbackAssignments) ?? 0,
      likelyEmptySpaces: asNumber(summary.likelyEmptySpaces) ?? emptySpaces.length,
      reviewSpaces: asNumber(summary.reviewSpaces) ?? reviewSpaces.length,
    },
    backendView: {
      occupiedSpaces,
      emptySpaces,
      reviewSpaces,
    },
  }
}

export type StackerGrid = Record<number, Record<number, StackerSpace | null>>

export function buildStackerGrid(data: CloudflareStackerData | null): StackerGrid {
  const grid: StackerGrid = {}
  for (let s = 1; s <= STACKER_COUNT; s++) {
    grid[s] = {}
    for (let l = 1; l <= LEVEL_COUNT; l++) {
      grid[s][l] = null
    }
  }

  const spaces = [
    ...(data?.backendView.occupiedSpaces ?? []),
    ...(data?.backendView.emptySpaces ?? []),
    ...(data?.backendView.reviewSpaces ?? []),
  ]

  for (const space of spaces) {
    if (
      space.stacker >= 1 &&
      space.stacker <= STACKER_COUNT &&
      space.level >= 1 &&
      space.level <= LEVEL_COUNT
    ) {
      grid[space.stacker][space.level] = space
    }
  }

  return grid
}

export function isVacantSpace(space: StackerSpace | null): boolean {
  return !space || space.status === 'likely-empty'
}
