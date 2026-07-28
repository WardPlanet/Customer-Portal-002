/**
 * Default credit rate table.
 * Rates are flat dollar amounts per office that successfully goes live.
 * All values are editable by ICs in the admin config panel.
 *
 * Deal size tiers:
 *   small  = 1–50 offices
 *   mid    = 51–100 offices
 *   large  = 101+ offices
 *
 * Pace:
 *   standard  = normal rollout cadence
 *   hyper     = aggressive/accelerated rollout
 */

export type Segment = 'commercial' | 'enterprise'
export type Pace = 'standard' | 'hyper'
export type DealTier = 'small' | 'mid' | 'large'
export type OfficeStatus = 'pending' | 'live' | 'missed'

export type RateTable = Record<Pace, Record<DealTier, number>>

export type CreditConfig = {
  segment: Segment
  pace: Pace
  totalOffices: number
  rateTable: RateTable
}

export type CreditOffice = {
  id: number
  name: string
  wave: number
  targetDate: string
  status: OfficeStatus
}

export type CreditSummaryTotals = {
  earned: number
  pending: number
  missed: number
  creditPerOffice: number
}

export const DEFAULT_RATE_TABLE: RateTable = {
  standard: { small: 2000, mid: 2200, large: 2500 },
  hyper:    { small: 3000, mid: 3300, large: 3500 },
}

export function getDealSizeTier(totalOffices: number): DealTier {
  if (totalOffices <= 50)  return 'small'
  if (totalOffices <= 100) return 'mid'
  return 'large'
}

export function getCreditPerOffice(config: CreditConfig): number {
  const { pace, totalOffices, rateTable } = config
  const tier = getDealSizeTier(totalOffices)
  return rateTable[pace][tier]
}

/**
 * Compute credit summary across all offices.
 *
 * For enterprise customers: all-or-nothing per wave (group of offices
 * scheduled together). If any office in a wave misses its go-live date,
 * no offices in that wave earn credit.
 *
 * For commercial customers: each office is evaluated individually.
 */
export function computeCredits(config: CreditConfig, offices: CreditOffice[]): CreditSummaryTotals {
  const creditPerOffice = getCreditPerOffice(config)
  const { segment } = config

  if (segment === 'enterprise') {
    return computeEnterpriseCredits(offices, creditPerOffice)
  }
  return computeCommercialCredits(offices, creditPerOffice)
}

function computeEnterpriseCredits(offices: CreditOffice[], creditPerOffice: number): CreditSummaryTotals {
  const waves = groupByWave(offices)
  let earned = 0
  let pending = 0
  let missed = 0

  for (const wave of Object.values(waves)) {
    const allLive   = wave.every(o => o.status === 'live')
    const anyMissed = wave.some(o => o.status === 'missed')
    const waveValue = wave.length * creditPerOffice

    if (allLive) {
      earned += waveValue
    } else if (anyMissed) {
      missed += waveValue
    } else {
      pending += waveValue
    }
  }

  return { earned, pending, missed, creditPerOffice }
}

function computeCommercialCredits(offices: CreditOffice[], creditPerOffice: number): CreditSummaryTotals {
  let earned = 0
  let pending = 0
  let missed = 0

  for (const office of offices) {
    if (office.status === 'live')        earned  += creditPerOffice
    else if (office.status === 'missed') missed  += creditPerOffice
    else                                  pending += creditPerOffice
  }

  return { earned, pending, missed, creditPerOffice }
}

function groupByWave(offices: CreditOffice[]): Record<number, CreditOffice[]> {
  return offices.reduce<Record<number, CreditOffice[]>>((acc, office) => {
    const key = office.wave
    if (!acc[key]) acc[key] = []
    acc[key].push(office)
    return acc
  }, {})
}

/**
 * Returns a fresh office object with sensible defaults.
 */
export function createOffice({ id, name, wave, targetDate }: { id: number; name: string; wave?: number; targetDate?: string }): CreditOffice {
  return { id, name, wave: wave ?? 1, targetDate: targetDate ?? '', status: 'pending' }
}
