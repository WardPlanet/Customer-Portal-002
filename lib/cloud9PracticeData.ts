export type C9Practice = {
  id:         string
  name:       string
  wave:       1 | 2 | 3
  goLiveDate: string   // display string e.g. "May 3, 2026"
  locations:  number
  licenses:   number
  currentPms: string
}

// One practice per wave; go-live dates spaced a month apart from Apr 3 2026
export const C9_PRACTICES: C9Practice[] = [
  { id: 'c9-w1-01', name: "Micah's Dental",  wave: 1, goLiveDate: 'May 3, 2026',  locations: 2, licenses: 15, currentPms: 'Dolphin' },
  { id: 'c9-w2-01', name: "Emily's Smiles",  wave: 2, goLiveDate: 'Jun 3, 2026',  locations: 3, licenses: 25, currentPms: 'N/A'     },
  { id: 'c9-w3-01', name: "Ian's Dentistry", wave: 3, goLiveDate: 'Jul 3, 2026',  locations: 4, licenses: 30, currentPms: 'Wave'    },
]

export function getC9PracticesByWave(wave: 1 | 2 | 3): C9Practice[] {
  return C9_PRACTICES.filter(p => p.wave === wave)
}
