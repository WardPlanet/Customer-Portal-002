export type Office = {
  id:         string
  name:       string
  oid:        string
  wave:       1 | 2 | 3
  goLiveDate: string   // display string e.g. "Aug 15, 2026"
}

export const OFFICES: Office[] = [
  // ── Wave 1 ──────────────────────────────────────────────────────────────────
  { id: 'w1-01', name: "Micah's Dental",         oid: '10045', wave: 1, goLiveDate: 'Aug 15, 2026' },
  { id: 'w1-02', name: "Emily's Smiles",          oid: '10046', wave: 1, goLiveDate: 'Aug 22, 2026' },
  { id: 'w1-03', name: "Ian's Dentistry",         oid: '10047', wave: 1, goLiveDate: 'Aug 29, 2026' },
  { id: 'w1-04', name: "Ward's Wisdom Teeth",     oid: '10048', wave: 1, goLiveDate: 'Sep 5, 2026'  },
  { id: 'w1-05', name: "Scott's Smirks",          oid: '10049', wave: 1, goLiveDate: 'Sep 12, 2026' },

  // ── Wave 2 ──────────────────────────────────────────────────────────────────
  { id: 'w2-01', name: "Mataya's Mouth Experts",  oid: '20150', wave: 2, goLiveDate: 'Oct 3, 2026'  },
  { id: 'w2-02', name: "Stephanie's Smile Source",oid: '20151', wave: 2, goLiveDate: 'Oct 10, 2026' },
  { id: 'w2-03', name: "Molly's Miracle Smiles",  oid: '20152', wave: 2, goLiveDate: 'Oct 17, 2026' },
  { id: 'w2-04', name: "Theresa's Teeth",         oid: '20153', wave: 2, goLiveDate: 'Oct 24, 2026' },
  { id: 'w2-05', name: "Ryan's Dental Practice",  oid: '20154', wave: 2, goLiveDate: 'Oct 31, 2026' },

  // ── Wave 3 ──────────────────────────────────────────────────────────────────
  { id: 'w3-01', name: "Denise's Dental",         oid: '30260', wave: 3, goLiveDate: 'Dec 5, 2026'  },
  { id: 'w3-02', name: "Mark's Manly Smiles",     oid: '30261', wave: 3, goLiveDate: 'Dec 12, 2026' },
  { id: 'w3-03', name: "Trisha's Expert Teeth",   oid: '30262', wave: 3, goLiveDate: 'Dec 19, 2026' },
  { id: 'w3-04', name: "Nicole's Nono-dental",    oid: '30263', wave: 3, goLiveDate: 'Jan 9, 2027'  },
  { id: 'w3-05', name: "Darc-Wine",               oid: '30264', wave: 3, goLiveDate: 'Jan 16, 2027' },
]

export function getOfficesByWave(wave: 1 | 2 | 3): Office[] {
  return OFFICES.filter(o => o.wave === wave)
}
