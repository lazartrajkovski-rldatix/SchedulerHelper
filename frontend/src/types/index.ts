export interface TimeSlot {
  id: number;
  from: string;
  to: string;
  name: string | null;
}

export interface Activity {
  id: number;
  duration: number;
  name: string;
}

export type RagStatusName = 'Green' | 'Yellow' | 'Red';
export type TreatmentTimeType = 'TimeSlots' | 'SpecificTime' | 'MultipleVisitsPerDay';

export interface Visit {
  treatmentId: number;
  band: string;
  bandId: number;
  patientName: string;
  nhsNumber: string;
  activities: Activity[];
  timeSlots: TimeSlot[];
  postcode: string;
  totalTime: number; // minutes
  numberOfClinicians: number;
  treatmentTimeType: TreatmentTimeType;
  label: string;
  ragStatus: { name: RagStatusName };
  preferredClinicianId: number | null;
  simulatedDistanceMiles: number;
}

export interface Clinician {
  id: number;
  name: string;
  band: string;
  gradeEquivalence: number;
  availabilities: Array<{
    id: number;
    actual: { startDate: string; endDate: string };
  }>;
  basePostCode: string;
  mileageCap: number;
  hasMileageCap: boolean;
  hasValidBasePostCode: boolean;
  assignedVisitsCount: number;
  clinicianColor: string;
}

export type ConstraintMode = 'hard' | 'soft' | 'off';

export interface ConstraintSetting {
  mode: ConstraintMode;
  weight: number; // 0-100, only used when mode === 'soft'
}

export interface ClinicConfig {
  constraints: {
    bandMatch: ConstraintSetting;
    timeWindow: ConstraintSetting;
    nurseAvailability: ConstraintSetting;
    mileageCap: ConstraintSetting;
    patientContinuity: ConstraintSetting;
    urgency: ConstraintSetting;
    bandEfficiency: ConstraintSetting;
    timeFlexibility: ConstraintSetting;
    workloadBalance: ConstraintSetting;
  };
}

export interface ScoreBreakdown {
  urgency: number;
  bandEfficiency: number;
  bandMatch: number;
  timeFlexibility: number;
  patientContinuity: number;
  workloadBalance: number;
  mileageCap: number;
  nurseAvailability: number;
  timeWindow: number;
}

export interface ScoredVisit {
  visit: Visit;
  isEligible: boolean;
  inBatch: boolean;
  ineligibilityReasons: string[];
  totalScore: number;
  scoreBreakdown: ScoreBreakdown;
  eligibleClinicians: Clinician[];
  /** Nurse the simulation would assign (best fit) */
  suggestedNurseId: number | null;
  /** ISO timestamp of the slot the simulation chose for this visit */
  suggestedSlotFrom: string | null;
  /** Visits that are blocking this one in the simulation (nurse committed elsewhere at every valid slot) */
  conflictsWith: Array<{ treatmentId: number; patientName: string }>;
  /** Human-readable explanation of why this visit couldn't be scheduled (empty string if placed OK) */
  conflictReason: string;
}
